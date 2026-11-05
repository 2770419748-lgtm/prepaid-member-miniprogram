import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { formatYuan } from '../common/money-words';
import { PayCodeService } from '../pay-code/pay-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumeDto, MoneyMoveDto, RefundDto, ReversalDto } from './dto/ledger.dto';
import { ledgerInclude, LedgerRecord, StaffLedgerView, toStaffLedgerView } from './ledger.view';
import { maxOffsetCent, ORDER_OFFSET_PERCENT } from './order-no';
import { OrderRedemptionService, redeemedMessage } from './order-redemption.service';

/** 钱包余额是 Int（分）。再往上加会溢出。 */
const MAX_BALANCE_CENT = 2_147_483_647;

/** 同一钱包被同时改动时最多重试几次。每次都会重新读余额、重新校验。 */
const MAX_ATTEMPTS = 8;

const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

export interface MoveResult {
  entry: StaffLedgerView;
  /** 这笔记完以后的余额，单位分。 */
  balanceCent: number;
  /** 同一请求号重复提交时为 true，返回的是第一次记下的那笔。 */
  replayed: boolean;
}

interface Movement {
  orgId: string;
  memberId: string;
  storeId: string;
  /** 签完权益单自动充值时是发起开单的店员；那位员工的账号没了时为空。 */
  operatorStaffId: string | null;
  type: LedgerType;
  /** 对余额的方向：1 加，-1 减。 */
  direction: 1 | -1;
  amountCent: number;
  remark: string | null;
  reversalOfId: string | null;
  requestId: string;
  /** 消费扣款用的会员码，和流水同一事务标成已用。 */
  payCodeId: string | null;
  /** 签完权益单后自动充值时，是哪一份权益单。写进操作记录。 */
  signFlowId: string | null;
  /** 消费抵扣的收银订单。只有消费有，和流水同一事务占住这张单。 */
  order: OrderOffset | null;
}

/** 一笔消费抵的是哪张收银订单。 */
interface OrderOffset {
  /** 规范写法 A+数字。 */
  orderNo: string;
  /** 商品应付金额（总计减优惠），分。 */
  productAmountCent: number;
  /** 店员手输的单号。 */
  typed: boolean;
}

/** 签完一份带会员权益金额的权益单后要充的那笔。 */
export interface SignedContractCredit {
  orgId: string;
  memberId: string;
  storeId: string;
  operatorStaffId: string | null;
  signFlowId: string;
  amountCent: number;
}

/** 权益单自动充值的请求号：由流程号派生，回调和刷新同时到、重复到都只记一笔。 */
export function signFlowRequestId(signFlowId: string): string {
  return `sign-flow-${signFlowId}`;
}

/** 乐观锁没抢到：别人先改了这只钱包。 */
class VersionConflict extends Error {}

const auditActionOf: Record<LedgerType, string> = {
  RECHARGE: AuditAction.WalletRecharge,
  CONSUME: AuditAction.WalletConsume,
  REVERSAL: AuditAction.WalletReversal,
  REFUND: AuditAction.WalletRefund,
};

function cleanRemark(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 判断「同一请求号是不是同一笔」时比哪些字段：冲正比原流水，充值、扣款比金额和门店，扣款还比订单号。 */
function requestShape(movement: Movement) {
  return {
    memberId: movement.memberId,
    type: movement.type,
    ...(movement.reversalOfId
      ? { reversalOfId: movement.reversalOfId }
      : { amountCent: movement.amountCent, storeId: movement.storeId }),
    ...(movement.order ? { orderNo: movement.order.orderNo } : {}),
  };
}

function pause(attempt: number): Promise<void> {
  const ms = Math.floor(Math.random() * 15 * attempt) + 1;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 余额只在这里改。
 * 每一笔都在同一个事务里：读钱包 → 校验余额 → 按 version 更新钱包 → 写流水 → 写操作记录。
 * 有人同时改了同一只钱包时 version 对不上，整笔回滚后重读重试，所以不会扣成负数，也不会丢账。
 * 数据库还有 CHECK 约束和只追加触发器兜底，见 M2 迁移。
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly payCodes: PayCodeService,
    private readonly orders: OrderRedemptionService,
  ) {}

  recharge(actor: AccessPrincipal, memberId: string, dto: MoneyMoveDto): Promise<MoveResult> {
    return this.move(actor, memberId, dto, LedgerType.RECHARGE, 1, null, null);
  }

  /**
   * 消费扣款必须带上这位店员在这家门店刚扫到的会员码（码只能用一次），
   * 和这笔抵的收银订单：最多抵商品应付金额的 10%，同一张单全公司只能抵一次（冲正后放开）。
   */
  async consume(actor: AccessPrincipal, memberId: string, dto: ConsumeDto): Promise<MoveResult> {
    const order: OrderOffset = {
      orderNo: this.orders.normalize(dto.orderNo),
      productAmountCent: dto.productAmountCent,
      typed: dto.orderNoTyped ?? false,
    };
    const cap = maxOffsetCent(order.productAmountCent);
    if (dto.amountCent > cap) {
      throw new BadRequestException(
        `这单最多只能抵 ${formatYuan(cap)} 元（商品金额 ${formatYuan(order.productAmountCent)} 元的 ${ORDER_OFFSET_PERCENT}%）`,
      );
    }
    return this.move(actor, memberId, dto, LedgerType.CONSUME, -1, dto.payCode, order);
  }

  /**
   * 会员签完带「会员权益金额」的权益单后，把这笔钱充进余额。由签署状态同步调用，不经店员再点一次。
   * 记在发起开单的门店和店员名下，和店员手动充值一样是一笔 RECHARGE，可以冲正。
   * 合同已经签了、钱已经在店里收了，所以不因门店或会员后来被停用而拒绝。
   */
  async creditSignedContract(credit: SignedContractCredit): Promise<MoveResult> {
    const requestId = signFlowRequestId(credit.signFlowId);
    const sameRequest = {
      memberId: credit.memberId,
      type: LedgerType.RECHARGE,
      amountCent: credit.amountCent,
      storeId: credit.storeId,
    };
    const replay = await this.replay(credit.orgId, requestId, sameRequest);
    if (replay) {
      return replay;
    }
    return this.apply({
      orgId: credit.orgId,
      memberId: credit.memberId,
      storeId: credit.storeId,
      operatorStaffId: credit.operatorStaffId,
      type: LedgerType.RECHARGE,
      direction: 1,
      amountCent: credit.amountCent,
      remark: '权益单签署后充值',
      reversalOfId: null,
      requestId,
      payCodeId: null,
      signFlowId: credit.signFlowId,
      order: null,
    });
  }

  /**
   * 退余额：把会员没用完的储值退给顾客（消保条例要求可退）。钱在门店线下退，这里只记一笔 REFUND 减余额。
   * 只有超级管理员（任一门店）或这家门店的店长能做；必须写原因和退款方式。可以只退一部分，不能超过余额。
   * 停用的会员也能退（先停用、再退余额是常见做法）；门店要在营。记错了可以冲正，钱加回余额。
   */
  async refund(actor: AccessPrincipal, memberId: string, dto: RefundDto): Promise<MoveResult> {
    const canRefund =
      isSuperAdmin(actor.roles) ||
      actor.roles.some((role) => role.storeId === dto.storeId && role.role === 'STORE_MANAGER');
    if (!canRefund) {
      throw new ForbiddenException('只有超级管理员或本店店长可以退余额');
    }
    const sameRequest = { memberId, type: LedgerType.REFUND, amountCent: dto.amountCent, storeId: dto.storeId };
    const replay = await this.replay(actor.orgId, dto.requestId, sameRequest);
    if (replay) {
      return replay;
    }
    const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能记账');
    }
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { wallet: { select: { id: true } } },
    });
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    if (!member.wallet) {
      throw new BadRequestException('会员还没开卡');
    }
    const remark = cleanRemark(dto.remark);
    if (!remark) {
      throw new BadRequestException('请写明退款原因和退款方式');
    }
    return this.apply({
      orgId: actor.orgId,
      memberId,
      storeId: store.id,
      operatorStaffId: actor.sub,
      type: LedgerType.REFUND,
      direction: -1,
      amountCent: dto.amountCent,
      remark,
      reversalOfId: null,
      requestId: dto.requestId,
      payCodeId: null,
      signFlowId: null,
      order: null,
    });
  }

  /**
   * 整笔冲回一条充值、消费或退款。冲正记在原流水的门店名下。
   * 只有超级管理员或原门店店长能做；一条流水只能冲一次；冲正流水不能再冲。
   */
  async reverse(actor: AccessPrincipal, entryId: string, dto: ReversalDto): Promise<MoveResult> {
    const original = await this.prisma.ledgerEntry.findUnique({
      where: { id: entryId },
      include: { reversedBy: { select: { id: true } } },
    });
    if (!original || original.orgId !== actor.orgId) {
      throw new NotFoundException('流水不存在');
    }
    const canReverse =
      isSuperAdmin(actor.roles) ||
      actor.roles.some((role) => role.storeId === original.storeId && role.role === 'STORE_MANAGER');
    if (!canReverse) {
      throw new ForbiddenException('只有超级管理员或原门店店长可以冲正');
    }
    const replay = await this.replay(actor.orgId, dto.requestId, {
      memberId: original.memberId,
      type: LedgerType.REVERSAL,
      reversalOfId: original.id,
    });
    if (replay) {
      return replay;
    }
    if (original.type === LedgerType.REVERSAL) {
      throw new BadRequestException('冲正流水不能再冲正');
    }
    if (original.reversedBy) {
      throw new ConflictException('这笔流水已经冲正过');
    }
    return this.apply({
      orgId: actor.orgId,
      memberId: original.memberId,
      storeId: original.storeId,
      operatorStaffId: actor.sub,
      type: LedgerType.REVERSAL,
      // 冲回充值减余额；冲回消费、退款把钱加回来。
      direction: original.type === LedgerType.RECHARGE ? -1 : 1,
      amountCent: original.amountCent,
      remark: cleanRemark(dto.remark),
      reversalOfId: original.id,
      requestId: dto.requestId,
      payCodeId: null,
      signFlowId: null,
      order: null,
    });
  }

  private async move(
    actor: AccessPrincipal,
    memberId: string,
    dto: MoneyMoveDto,
    type: LedgerType,
    direction: 1 | -1,
    payCode: string | null,
    order: OrderOffset | null,
  ): Promise<MoveResult> {
    assertStoreAccess(actor.roles, dto.storeId);
    const sameRequest = {
      memberId,
      type,
      amountCent: dto.amountCent,
      storeId: dto.storeId,
      ...(order ? { orderNo: order.orderNo } : {}),
    };
    const replay = await this.replay(actor.orgId, dto.requestId, sameRequest);
    if (replay) {
      return replay;
    }
    const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能记账');
    }
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { wallet: { select: { id: true } } },
    });
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException('会员已停用，不能记账');
    }
    if (!member.wallet) {
      throw new BadRequestException('会员还没开卡');
    }
    let payCodeId: string | null = null;
    if (payCode != null || order != null) {
      try {
        if (order) {
          await this.orders.assertNotRedeemed(actor.orgId, order.orderNo);
        }
        if (payCode != null) {
          payCodeId = (await this.payCodes.assertUsable(actor, memberId, store.id, payCode)).id;
        }
      } catch (error) {
        // 同一请求号的另一次提交（连点、网络重试）可能刚刚用掉了这张码、占了这张单：
        // 返回那一笔，不报「已经用过了」「已经抵扣过了」。
        const replayed = await this.replay(actor.orgId, dto.requestId, sameRequest);
        if (replayed) {
          return replayed;
        }
        throw error;
      }
    }
    return this.apply({
      orgId: actor.orgId,
      memberId,
      storeId: store.id,
      operatorStaffId: actor.sub,
      type,
      direction,
      amountCent: dto.amountCent,
      remark: cleanRemark(dto.remark),
      reversalOfId: null,
      requestId: dto.requestId,
      payCodeId,
      signFlowId: null,
      order,
    });
  }

  private async apply(movement: Movement): Promise<MoveResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.applyOnce(tx, movement), TX_OPTIONS);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return this.afterDuplicate(movement);
        }
        // 同一请求号的另一次提交（连点、网络重试）可能刚刚记完：余额已经变了，这次会撞版本或报余额不足。
        // 是它就返回那一笔，不重试、不报错。例如同时冲正两次一笔充值，第二次不该报「余额不足」。
        const replayed = await this.replay(movement.orgId, movement.requestId, requestShape(movement));
        if (replayed) {
          return replayed;
        }
        if (error instanceof VersionConflict) {
          if (attempt < MAX_ATTEMPTS) {
            await pause(attempt);
            continue;
          }
          throw new ConflictException('账户正在被其他操作修改，请稍后重试');
        }
        throw error;
      }
    }
  }

  private async applyOnce(tx: Prisma.TransactionClient, movement: Movement): Promise<MoveResult> {
    const wallet = await tx.wallet.findUnique({ where: { memberId: movement.memberId } });
    if (!wallet) {
      throw new BadRequestException('会员还没开卡');
    }
    const balanceAfter = wallet.balanceCent + movement.direction * movement.amountCent;
    if (balanceAfter < 0) {
      throw new BadRequestException(
        movement.type === LedgerType.REVERSAL
          ? '余额不足，无法冲正这笔充值'
          : movement.type === LedgerType.REFUND
            ? '退款金额超过了会员余额'
            : '余额不足',
      );
    }
    if (balanceAfter > MAX_BALANCE_CENT) {
      throw new BadRequestException('超出单个账户的余额上限');
    }
    const updated = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: { balanceCent: balanceAfter, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new VersionConflict();
    }
    const entry = await tx.ledgerEntry.create({
      data: {
        orgId: movement.orgId,
        memberId: movement.memberId,
        walletId: wallet.id,
        storeId: movement.storeId,
        operatorStaffId: movement.operatorStaffId,
        type: movement.type,
        amountCent: movement.amountCent,
        balanceBefore: wallet.balanceCent,
        balanceAfter,
        remark: movement.remark,
        reversalOfId: movement.reversalOfId,
        requestId: movement.requestId,
        orderNo: movement.order?.orderNo ?? null,
        productAmountCent: movement.order?.productAmountCent ?? null,
        orderNoTyped: movement.order?.typed ?? null,
      },
      include: ledgerInclude,
    });
    // 占单和放开也在写流水之后，理由同下面的会员码：同一请求号并发提交时先撞流水的唯一约束。
    // 两笔同时抵同一张单（不同请求号）时，第二笔在这里撞部分唯一索引，整笔回滚。
    if (movement.order) {
      await this.orders.occupy(tx, movement.orgId, movement.order.orderNo, entry.id);
    }
    if (movement.reversalOfId) {
      await this.orders.release(tx, movement.reversalOfId, entry.id);
    }
    // 放在写流水之后：同一请求号并发提交时先撞流水的唯一约束，走重放，而不是报码已用过。
    // 带码的只有店员扫码扣款，一定有操作人。
    if (movement.payCodeId) {
      await this.payCodes.markUsed(tx, movement.payCodeId, movement.operatorStaffId!, movement.storeId, entry.id);
    }
    await this.audit.write(tx, {
      orgId: movement.orgId,
      actorStaffId: movement.operatorStaffId,
      storeId: movement.storeId,
      action: auditActionOf[movement.type],
      targetType: 'LedgerEntry',
      targetId: entry.id,
      payload: {
        memberId: movement.memberId,
        storeId: movement.storeId,
        amountCent: movement.amountCent,
        balanceBefore: wallet.balanceCent,
        balanceAfter,
        ...(movement.reversalOfId ? { reversalOfId: movement.reversalOfId } : {}),
        ...(movement.payCodeId ? { payCodeId: movement.payCodeId } : {}),
        ...(movement.signFlowId ? { signFlowId: movement.signFlowId } : {}),
        ...(movement.order
          ? {
              orderNo: movement.order.orderNo,
              productAmountCent: movement.order.productAmountCent,
              ...(movement.order.typed ? { orderNoTyped: true } : {}),
            }
          : {}),
        // 退余额的原因和退款方式、冲正的原因，要在操作记录里看得到。
        ...((movement.type === LedgerType.REFUND || movement.type === LedgerType.REVERSAL) && movement.remark
          ? { remark: movement.remark }
          : {}),
      },
    });
    return { entry: toStaffLedgerView(entry), balanceCent: balanceAfter, replayed: false };
  }

  /** 撞了唯一约束：要么同一请求号并发提交，要么同一条流水被并发冲正。 */
  private async afterDuplicate(movement: Movement): Promise<MoveResult> {
    const replay = await this.replay(movement.orgId, movement.requestId, requestShape(movement));
    if (replay) {
      return replay;
    }
    if (movement.reversalOfId) {
      throw new ConflictException('这笔流水已经冲正过');
    }
    if (movement.order) {
      const redeemed = await this.orders.findActive(this.prisma, movement.orgId, movement.order.orderNo);
      if (redeemed) {
        throw new ConflictException(redeemedMessage(redeemed));
      }
    }
    throw new ConflictException('重复提交，请刷新后再试');
  }

  /**
   * 同一请求号已经记过账：内容一致就原样返回第一次的结果，不一致就拒绝。
   * 还没记过则返回 null。
   */
  private async replay(
    orgId: string,
    requestId: string,
    expected: Partial<Pick<LedgerRecord, 'memberId' | 'type' | 'amountCent' | 'storeId' | 'reversalOfId' | 'orderNo'>>,
  ): Promise<MoveResult | null> {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { orgId_requestId: { orgId, requestId } },
      include: ledgerInclude,
    });
    if (!entry) {
      return null;
    }
    const same = (Object.keys(expected) as (keyof typeof expected)[]).every(
      (key) => entry[key] === expected[key],
    );
    if (!same) {
      throw new ConflictException('这个请求号已经用于另一笔记账');
    }
    return { entry: toStaffLedgerView(entry), balanceCent: entry.balanceAfter, replayed: true };
  }
}
