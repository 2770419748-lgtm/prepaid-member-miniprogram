import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Member, Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertMainlandMobile, normalizePhone } from '../auth/phone';
import { PrismaService } from '../prisma/prisma.service';
import { MemberStatusDto, UpdateMemberDto } from './dto/member-card.dto';
import { memberCardInclude, MemberCardView, toMemberCardView } from './member.view';

/** 没签完的权益单状态。这时换手机号，e签宝那边的签署人还是旧号，签不下去。 */
const OPEN_SIGN_STATUSES = ['DRAFT', 'PENDING'] as const;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function cleanText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * 超级管理员维护会员：换手机号、改称呼、停用和恢复。都写操作记录。
 * 换手机号和停用会让会员小程序之前的登录全部作废（登录版本号加一），丢了手机的顾客可以靠这个止损。
 * 余额、流水跟着会员走，不受影响。
 */
@Injectable()
export class MemberAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async update(actor: AccessPrincipal, memberId: string, dto: UpdateMemberDto): Promise<MemberCardView> {
    const member = await this.find(actor, memberId);
    const nextPhone = dto.phone === undefined ? member.phone : normalizePhone(dto.phone);
    if (dto.phone !== undefined) {
      assertMainlandMobile(nextPhone);
    }
    const nextName = dto.name === undefined ? member.name : cleanText(dto.name);
    const phoneChanged = nextPhone !== member.phone;
    const nameChanged = nextName !== member.name;
    if (!phoneChanged && !nameChanged) {
      throw new BadRequestException('没有要修改的内容');
    }
    const reason = cleanText(dto.reason);
    if (phoneChanged && !reason) {
      throw new BadRequestException('换手机号请写明原因');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        let releasedMemberId: string | null = null;
        if (phoneChanged) {
          const openSign = await tx.signFlow.count({
            where: { memberId: member.id, status: { in: [...OPEN_SIGN_STATUSES] } },
          });
          if (openSign > 0) {
            throw new ConflictException('这位会员有没签完的权益单，请先撤销或等签完再换手机号');
          }
          releasedMemberId = await this.releaseEmptyLogin(tx, actor.orgId, nextPhone);
        }
        const updated = await tx.member.update({
          where: { id: member.id },
          data: {
            phone: nextPhone,
            name: nextName,
            // 旧手机号对应的微信绑定不要了，会员用新号登录时重新绑定；之前的登录全部作废。
            ...(phoneChanged ? { wxOpenId: null, wxUnionId: null, sessionVersion: { increment: 1 } } : {}),
          },
          include: memberCardInclude,
        });
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          action: AuditAction.MemberUpdate,
          targetType: 'Member',
          targetId: member.id,
          payload: {
            ...(phoneChanged ? { previousPhone: member.phone, phone: nextPhone } : {}),
            ...(nameChanged ? { previousName: member.name ?? '', name: nextName ?? '' } : {}),
            ...(reason ? { reason } : {}),
            ...(releasedMemberId ? { releasedMemberId } : {}),
          },
        });
        return toMemberCardView(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('这个手机号已经是另一位会员的了');
      }
      throw error;
    }
  }

  async disable(actor: AccessPrincipal, memberId: string, dto: MemberStatusDto): Promise<MemberCardView> {
    const member = await this.find(actor, memberId);
    if (member.status === 'DISABLED') {
      throw new ConflictException('这位会员已经停用了');
    }
    return this.setStatus(actor, member, 'DISABLED', dto.reason.trim());
  }

  async enable(actor: AccessPrincipal, memberId: string, dto: MemberStatusDto): Promise<MemberCardView> {
    const member = await this.find(actor, memberId);
    if (member.status === 'ACTIVE') {
      throw new ConflictException('这位会员没有停用');
    }
    return this.setStatus(actor, member, 'ACTIVE', dto.reason.trim());
  }

  private async setStatus(
    actor: AccessPrincipal,
    member: Member,
    status: 'ACTIVE' | 'DISABLED',
    reason: string,
  ): Promise<MemberCardView> {
    if (!reason) {
      throw new BadRequestException('请写明原因');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.member.update({
        where: { id: member.id },
        // 停用时登录版本号加一：以后恢复了，停用前的旧登录也不会复活，要重新登录。
        data: { status, ...(status === 'DISABLED' ? { sessionVersion: { increment: 1 } } : {}) },
        include: memberCardInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: status === 'DISABLED' ? AuditAction.MemberDisable : AuditAction.MemberEnable,
        targetType: 'Member',
        targetId: member.id,
        payload: { status, reason },
      });
      return toMemberCardView(updated);
    });
  }

  private async find(actor: AccessPrincipal, memberId: string): Promise<Member> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    return member;
  }

  /**
   * 新手机号已经被占用时：如果那只是顾客用新号登录过一次会员小程序留下的空记录
   * （没开卡、没有流水、权益单和会员码），删掉它把号让出来，返回它的 ID；否则 409。
   */
  private async releaseEmptyLogin(
    tx: Prisma.TransactionClient,
    orgId: string,
    phone: string,
  ): Promise<string | null> {
    const holder = await tx.member.findUnique({
      where: { orgId_phone: { orgId, phone } },
      include: {
        wallet: { select: { id: true } },
        _count: { select: { ledger: true, signFlows: true, payCodes: true } },
      },
    });
    if (!holder) {
      return null;
    }
    const empty =
      holder.wallet == null &&
      holder._count.ledger === 0 &&
      holder._count.signFlows === 0 &&
      holder._count.payCodes === 0;
    if (!empty) {
      throw new ConflictException('这个手机号已经是另一位会员的了');
    }
    await tx.member.delete({ where: { id: holder.id } });
    return holder.id;
  }
}
