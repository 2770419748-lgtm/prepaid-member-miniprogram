import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MemberPayCode, Prisma } from '@prisma/client';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess } from '../auth/staff-access';
import { memberCardInclude, toMemberCardView } from '../members/member.view';
import { PrismaService } from '../prisma/prisma.service';
import { ScanPayCodeDto } from './dto/pay-code.dto';
import {
  generatePayCode,
  hashPayCode,
  normalizePayCode,
  PAY_CODE_CLAIM_MS,
  PAY_CODE_REFRESH_MS,
  PAY_CODE_TTL_MS,
} from './pay-code';
import {
  IssuedPayCodeView,
  MemberPayCodeStatusView,
  payCodeStatusInclude,
  ScannedPayCodeView,
  toMemberPayCodeStatusView,
} from './pay-code.view';

const NOT_A_CODE = '这不是会员码，请扫顾客小程序里的会员码';
const REFRESH = '请顾客刷新会员码后重新扫';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type PayCodeTx = Pick<Prisma.TransactionClient, 'memberPayCode'>;

/**
 * 会员码。消费扣款前店员必须先扫会员出示的码，这样店员不能在会员不在场时扣款。
 *
 * 一张码的一生：会员小程序取码（ISSUED，1 分钟内有效，换新码时旧的未扫码作废）
 * → 店员扫码（SCANNED，记下谁、在哪家店扫的，之后 5 分钟内只有他在这家店能用）
 * → 扣款成功（USED，和流水在同一事务里标记，指向那笔流水，之后不能再用）。
 */
@Injectable()
export class PayCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 会员取一张新会员码，同时作废自己之前还没被扫的码。 */
  async issue(principal: AccessPrincipal): Promise<IssuedPayCodeView> {
    const member = await this.memberOf(principal);
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException('会员卡已停用，不能出示会员码');
    }
    if (!member.wallet) {
      throw new BadRequestException('还没开卡，到门店开卡后才能使用会员码');
    }
    for (let attempt = 1; ; attempt += 1) {
      const code = generatePayCode();
      const expiresAt = new Date(Date.now() + PAY_CODE_TTL_MS);
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          await tx.memberPayCode.deleteMany({ where: { memberId: member.id, status: 'ISSUED' } });
          return tx.memberPayCode.create({
            data: { orgId: member.orgId, memberId: member.id, codeHash: hashPayCode(code), expiresAt },
          });
        });
        return {
          id: row.id,
          code,
          expiresAt: row.expiresAt.toISOString(),
          refreshAfterSeconds: PAY_CODE_REFRESH_MS / 1000,
        };
      } catch (error) {
        // 随机出了一张已有的码（概率极小），换一张再来。
        if (isUniqueViolation(error) && attempt < 3) {
          continue;
        }
        throw error;
      }
    }
  }

  /** 会员看自己某张码的状态。换过新码以后旧码已经删了，返回 404。 */
  async statusForMember(principal: AccessPrincipal, id: string): Promise<MemberPayCodeStatusView> {
    if (principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    const row = await this.prisma.memberPayCode.findUnique({ where: { id }, include: payCodeStatusInclude });
    if (!row || row.memberId !== principal.sub || row.orgId !== principal.orgId) {
      throw new NotFoundException('会员码已更新');
    }
    return toMemberPayCodeStatusView(row, new Date());
  }

  /**
   * 店员扫码。成功后这张码归这位店员在这家门店使用，别人再扫会被拒绝。
   * 同一位店员在同一家门店重复扫（比如网络断了重扫）返回同样的结果。
   */
  async scan(actor: AccessPrincipal, dto: ScanPayCodeDto): Promise<ScannedPayCodeView> {
    assertStoreAccess(actor.roles, dto.storeId);
    const code = normalizePayCode(dto.code);
    if (!code) {
      throw new BadRequestException(NOT_A_CODE);
    }
    const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能记账');
    }
    const row = await this.prisma.memberPayCode.findUnique({ where: { codeHash: hashPayCode(code) } });
    if (!row || row.orgId !== actor.orgId) {
      throw new BadRequestException(`会员码已失效，${REFRESH}`);
    }
    const member = await this.prisma.member.findUnique({ where: { id: row.memberId }, include: memberCardInclude });
    if (!member) {
      throw new BadRequestException(`会员码已失效，${REFRESH}`);
    }
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException('该会员已停用，不能记账');
    }
    if (!member.wallet) {
      throw new BadRequestException('该会员还没开卡');
    }
    const now = new Date();
    if (row.status === 'ISSUED') {
      if (row.expiresAt <= now) {
        throw new BadRequestException(`会员码已过期，${REFRESH}`);
      }
      const claimExpiresAt = new Date(now.getTime() + PAY_CODE_CLAIM_MS);
      const claimed = await this.prisma.memberPayCode.updateMany({
        where: { id: row.id, status: 'ISSUED', expiresAt: { gt: now } },
        data: {
          status: 'SCANNED',
          scannedAt: now,
          scannedByStaffId: actor.sub,
          scannedStoreId: store.id,
          claimExpiresAt,
        },
      });
      if (claimed.count !== 1) {
        // 就在这一刻被别人扫走、或者会员换了新码。
        throw new ConflictException(`会员码已失效，${REFRESH}`);
      }
      return { member: toMemberCardView(member), expiresAt: claimExpiresAt.toISOString() };
    }
    if (row.status === 'USED') {
      throw new ConflictException(`这张会员码已经用过了，${REFRESH}`);
    }
    if (row.scannedByStaffId !== actor.sub || row.scannedStoreId !== store.id) {
      throw new ConflictException(`这张会员码已经被扫过了，${REFRESH}`);
    }
    if (!row.claimExpiresAt || row.claimExpiresAt <= now) {
      throw new BadRequestException(`会员码已过期，${REFRESH}`);
    }
    return { member: toMemberCardView(member), expiresAt: row.claimExpiresAt.toISOString() };
  }

  /**
   * 扣款前检查会员码：必须是这位会员的、由这位店员在这家门店扫过、还在扣款期限内、没用过。
   * 只用来给出清楚的提示；真正占用在 markUsed 里和流水同一事务完成。
   */
  async assertUsable(
    actor: AccessPrincipal,
    memberId: string,
    storeId: string,
    raw: string,
  ): Promise<MemberPayCode> {
    const code = normalizePayCode(raw);
    if (!code) {
      throw new BadRequestException('会员码不对，请重新扫码');
    }
    const row = await this.prisma.memberPayCode.findUnique({ where: { codeHash: hashPayCode(code) } });
    if (!row || row.orgId !== actor.orgId) {
      throw new BadRequestException(`会员码已失效，${REFRESH}`);
    }
    if (row.memberId !== memberId) {
      throw new BadRequestException('这张会员码不是这位会员的，请重新扫码');
    }
    if (row.status === 'USED') {
      throw new ConflictException(`这张会员码已经用过了，${REFRESH}`);
    }
    if (row.status === 'ISSUED') {
      throw new BadRequestException('请先扫顾客的会员码');
    }
    if (row.scannedByStaffId !== actor.sub || row.scannedStoreId !== storeId) {
      throw new ForbiddenException('这张会员码不是你在这家门店扫的，请重新扫码');
    }
    if (!row.claimExpiresAt || row.claimExpiresAt <= new Date()) {
      throw new BadRequestException(`扫码已超过 5 分钟，${REFRESH}`);
    }
    return row;
  }

  /**
   * 在扣款事务里把码标成已用。和 assertUsable 之间如果码被用掉或过期，这里更新不到，整笔扣款回滚。
   */
  async markUsed(
    tx: PayCodeTx,
    payCodeId: string,
    actorStaffId: string,
    storeId: string,
    ledgerEntryId: string,
  ): Promise<void> {
    const now = new Date();
    const used = await tx.memberPayCode.updateMany({
      where: {
        id: payCodeId,
        status: 'SCANNED',
        scannedByStaffId: actorStaffId,
        scannedStoreId: storeId,
        claimExpiresAt: { gt: now },
      },
      data: { status: 'USED', usedAt: now, ledgerEntryId },
    });
    if (used.count !== 1) {
      throw new ConflictException(`会员码已失效，${REFRESH}`);
    }
  }

  private async memberOf(principal: AccessPrincipal) {
    if (principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    const member = await this.prisma.member.findUnique({
      where: { id: principal.sub },
      include: { wallet: { select: { id: true } } },
    });
    if (!member || member.orgId !== principal.orgId) {
      throw new UnauthorizedException('登录已失效');
    }
    return member;
  }
}
