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
import { PrismaService } from '../prisma/prisma.service';
import { MoneyMoveDto, ReversalDto } from './dto/ledger.dto';
import { ledgerInclude, LedgerRecord, StaffLedgerView, toStaffLedgerView } from './ledger.view';

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
  operatorStaffId: string;
  type: LedgerType;
  /** 对余额的方向：1 加，-1 减。 */
  direction: 1 | -1;
  amountCent: number;
  remark: string | null;
  reversalOfId: string | null;
  requestId: string | null;
}

/** 乐观锁没抢到：别人先改了这只钱包。 */
class VersionConflict extends Error {}

const auditActionOf: Record<LedgerType, string> = {
  RECHARGE: AuditAction.WalletRecharge,
  CONSUME: AuditAction.WalletConsume,
  REVERSAL: AuditAction.WalletReversal,
};

function cleanRemark(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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
  ) {}

  recharge(actor: AccessPrincipal, memberId: string, dto: MoneyMoveDto): Promise<MoveResult> {
    return this.move(actor, memberId, dto, LedgerType.RECHARGE, 1);
  }

  consume(actor: AccessPrincipal, memberId: string, dto: MoneyMoveDto): Promise<MoveResult> {
    return this.move(actor, memberId, dto, LedgerType.CONSUME, -1);
  }

  /**
   * 整笔冲回一条充值或消费。冲正记在原流水的门店名下。
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
      direction: original.type === LedgerType.RECHARGE ? -1 : 1,
      amountCent: original.amountCent,
      remark: cleanRemark(dto.remark),
      reversalOfId: original.id,
      requestId: dto.requestId ?? null,
    });
  }

  private async move(
    actor: AccessPrincipal,
    memberId: string,
    dto: MoneyMoveDto,
    type: LedgerType,
    direction: 1 | -1,
  ): Promise<MoveResult> {
    assertStoreAccess(actor.roles, dto.storeId);
    const replay = await this.replay(actor.orgId, dto.requestId, {
      memberId,
      type,
      amountCent: dto.amountCent,
      storeId: dto.storeId,
    });
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
      requestId: dto.requestId ?? null,
    });
  }

  private async apply(movement: Movement): Promise<MoveResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.applyOnce(tx, movement), TX_OPTIONS);
      } catch (error) {
        if (error instanceof VersionConflict) {
          if (attempt < MAX_ATTEMPTS) {
            await pause(attempt);
            continue;
          }
          throw new ConflictException('账户正在被其他操作修改，请稍后重试');
        }
        if (isUniqueViolation(error)) {
          return this.afterDuplicate(movement);
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
        movement.type === LedgerType.REVERSAL ? '余额不足，无法冲正这笔充值' : '余额不足',
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
      },
      include: ledgerInclude,
    });
    await this.audit.write(tx, {
      orgId: movement.orgId,
      actorStaffId: movement.operatorStaffId,
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
      },
    });
    return { entry: toStaffLedgerView(entry), balanceCent: balanceAfter, replayed: false };
  }

  /** 撞了唯一约束：要么同一请求号并发提交，要么同一条流水被并发冲正。 */
  private async afterDuplicate(movement: Movement): Promise<MoveResult> {
    const replay = await this.replay(movement.orgId, movement.requestId ?? undefined, {
      memberId: movement.memberId,
      type: movement.type,
      ...(movement.reversalOfId
        ? { reversalOfId: movement.reversalOfId }
        : { amountCent: movement.amountCent, storeId: movement.storeId }),
    });
    if (replay) {
      return replay;
    }
    if (movement.reversalOfId) {
      throw new ConflictException('这笔流水已经冲正过');
    }
    throw new ConflictException('重复提交，请刷新后再试');
  }

  /**
   * 同一请求号已经记过账：内容一致就原样返回第一次的结果，不一致就拒绝。
   * 没带请求号或还没记过则返回 null。
   */
  private async replay(
    orgId: string,
    requestId: string | undefined,
    expected: Partial<Pick<LedgerRecord, 'memberId' | 'type' | 'amountCent' | 'storeId' | 'reversalOfId'>>,
  ): Promise<MoveResult | null> {
    if (!requestId) {
      return null;
    }
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
