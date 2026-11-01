import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Member, Prisma, Staff, StaffStoreRole } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { toMemberView } from '../members/member.view';
import { PrismaService } from '../prisma/prisma.service';
import { AccessPrincipal, LoginMethod } from './access-principal';
import { AccessTokenService } from './access-token.service';
import { ChangeStaffPasswordDto, StaffPasswordLoginDto } from './dto/staff-password.dto';
import { WxPhoneLoginDto } from './dto/wx-phone-login.dto';
import { OrgResolver } from './org-resolver.service';
import { hashPassword, lockActive, lockAfterFailure, passwordMatches } from './password';
import { assertMainlandMobile, normalizePhone } from './phone';
import { PhoneIdentity, WechatIdentityService } from './wechat/wechat-identity.service';

const staffLoginInclude = {
  storeRoles: { include: { store: { select: { name: true } } } },
} satisfies Prisma.StaffInclude;

type StaffLoginRecord = Staff & {
  storeRoles: (StaffStoreRole & { store: { name: string } })[];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgResolver,
    private readonly wechat: WechatIdentityService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditLogWriter,
  ) {}

  async loginMember(dto: WxPhoneLoginDto) {
    const identity = await this.wechat.resolve('member', dto);
    const orgId = await this.orgs.resolve(dto.orgId);
    const member = await this.saveMember(orgId, identity);
    return this.issueMemberSession(member);
  }

  /**
   * 会员小程序续期：拿还没过期的登录换一张新的，有效期从现在重新算（默认 30 天）。
   * 小程序每天打开时调一次，常用就一直不用重新登录。会员被停用后旧登录在守卫里就被拒（401）。
   */
  async renewMemberSession(principal: AccessPrincipal) {
    if (principal.principalType !== 'MEMBER') {
      throw new ForbiddenException('只有会员小程序的登录可以续期');
    }
    const member = await this.prisma.member.findUnique({ where: { id: principal.sub } });
    if (!member || member.orgId !== principal.orgId || member.status !== 'ACTIVE') {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return this.issueMemberSession(member);
  }

  async loginStaff(dto: WxPhoneLoginDto) {
    const identity = await this.wechat.resolve('staff', dto);
    const orgId = await this.orgs.resolve(dto.orgId);
    const staff = await this.prisma.staff.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
      include: staffLoginInclude,
    });
    if (!staff) {
      throw new UnauthorizedException('账号未开通');
    }
    if (staff.status !== 'ACTIVE') {
      throw new ForbiddenException('账号已停用');
    }
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { wxOpenId: identity.openId },
    });
    return this.issueStaffSession(staff, 'WECHAT');
  }

  async loginStaffWithPassword(dto: StaffPasswordLoginDto) {
    const phone = normalizePhone(dto.phone);
    assertMainlandMobile(phone);
    const orgId = await this.orgs.resolve(dto.orgId);
    const staff = await this.prisma.staff.findUnique({
      where: { orgId_phone: { orgId, phone } },
      include: staffLoginInclude,
    });
    if (!staff) {
      await passwordMatches(dto.password, null);
      throw new UnauthorizedException('手机号或密码错误');
    }
    if (staff.status !== 'ACTIVE') {
      throw new ForbiddenException('账号已停用');
    }
    if (lockActive(staff.lockedUntil, new Date())) {
      throw new ForbiddenException('登录已锁定，请 15 分钟后再试');
    }
    const matches = await passwordMatches(dto.password, staff.passwordHash);
    if (!matches) {
      await this.recordPasswordFailure(staff.id);
    }
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return this.issueStaffSession(staff, 'PASSWORD');
  }

  /**
   * 员工小程序续期：拿还没过期的登录换一张新的，有效期从现在重新算（默认 30 天，和会员小程序一样）。
   * 小程序每天打开时调一次，天天用就一直不用重新登录。
   * 停用、改密、重置密码后旧登录在守卫里就被拒（401），换不到新的。网页后台的密码登录不续期。
   */
  async renewStaffSession(principal: AccessPrincipal) {
    if (principal.principalType !== 'STAFF' || principal.session?.method !== 'WECHAT') {
      throw new ForbiddenException('只有员工小程序的登录可以续期');
    }
    const staff = await this.prisma.staff.findUnique({
      where: { id: principal.sub },
      include: staffLoginInclude,
    });
    if (
      !staff ||
      staff.orgId !== principal.orgId ||
      staff.status !== 'ACTIVE' ||
      staff.sessionVersion !== principal.session.version
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return this.issueStaffSession(staff, 'WECHAT');
  }

  /** 改完以后这位员工之前的登录全部作废（网页和小程序都要重新登录）。 */
  async changeStaffPassword(principal: AccessPrincipal, dto: ChangeStaffPasswordDto) {
    if (principal.principalType !== 'STAFF') {
      throw new ForbiddenException('无权执行该操作');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: principal.sub } });
    if (!staff || staff.orgId !== principal.orgId || staff.status !== 'ACTIVE') {
      throw new UnauthorizedException('登录已失效');
    }
    const matches = await passwordMatches(dto.currentPassword, staff.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('当前密码不正确');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staff.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      });
      await this.audit.write(tx, {
        orgId: staff.orgId,
        actorStaffId: staff.id,
        action: AuditAction.StaffPasswordChange,
        targetType: 'Staff',
        targetId: staff.id,
        payload: { mustChangePassword: false },
      });
    });
    return { mustChangePassword: false };
  }

  async me(principal: AccessPrincipal) {
    if (principal.principalType === 'MEMBER') {
      const member = await this.prisma.member.findUnique({ where: { id: principal.sub } });
      if (!member || member.orgId !== principal.orgId) {
        throw new UnauthorizedException('登录已失效');
      }
      const view = toMemberView(member);
      return { principalType: 'MEMBER' as const, needsCard: view.needsCard, member: view };
    }
    const staff = await this.prisma.staff.findUnique({
      where: { id: principal.sub },
      include: { storeRoles: { include: { store: { select: { name: true } } } } },
    });
    if (!staff || staff.orgId !== principal.orgId) {
      throw new UnauthorizedException('登录已失效');
    }
    return {
      principalType: 'STAFF' as const,
      staff: {
        id: staff.id,
        orgId: staff.orgId,
        phone: staff.phone,
        name: staff.name,
        status: staff.status,
        wxOpenId: staff.wxOpenId,
        mustChangePassword: staff.mustChangePassword,
      },
      roles: staff.storeRoles.map((role) => ({
        storeId: role.storeId,
        role: role.role,
        storeName: role.store.name,
      })),
    };
  }

  private issueMemberSession(member: Member) {
    const view = toMemberView(member);
    const issued = this.tokens.issue({
      sub: member.id,
      orgId: member.orgId,
      principalType: 'MEMBER',
      roles: [],
    });
    return {
      accessToken: issued.accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: issued.expiresIn,
      principalType: 'MEMBER' as const,
      needsCard: view.needsCard,
      member: view,
    };
  }

  private issueStaffSession(staff: StaffLoginRecord, method: LoginMethod) {
    const roles = staff.storeRoles.map((role) => ({
      storeId: role.storeId,
      role: role.role,
      storeName: role.store.name,
    }));
    const issued = this.tokens.issue({
      sub: staff.id,
      orgId: staff.orgId,
      principalType: 'STAFF',
      roles: roles.map((role) => ({ storeId: role.storeId, role: role.role })),
      session: { version: staff.sessionVersion, method },
    });
    return {
      accessToken: issued.accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: issued.expiresIn,
      principalType: 'STAFF' as const,
      mustChangePassword: staff.mustChangePassword,
      staff: {
        id: staff.id,
        orgId: staff.orgId,
        phone: staff.phone,
        name: staff.name,
        status: staff.status,
      },
      roles,
    };
  }

  private async recordPasswordFailure(staffId: string): Promise<never> {
    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const outcome = lockAfterFailure(updated.failedLoginCount, new Date());
    if (outcome.locked) {
      await this.prisma.staff.update({
        where: { id: staffId },
        data: { failedLoginCount: 0, lockedUntil: outcome.lockedUntil },
      });
      throw new ForbiddenException('登录已锁定，请 15 分钟后再试');
    }
    throw new UnauthorizedException('手机号或密码错误');
  }

  private async saveMember(orgId: string, identity: PhoneIdentity) {
    const existing = await this.prisma.member.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
    });
    if (existing?.status === 'DISABLED') {
      throw new ForbiddenException('账号已停用');
    }
    if (!existing) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const created = await tx.member.create({
            data: {
              orgId,
              phone: identity.phone,
              wxOpenId: identity.openId,
              wxUnionId: identity.unionId,
              status: 'ACTIVE',
            },
          });
          await this.audit.write(tx, {
            orgId,
            action: AuditAction.MemberIdentityCreate,
            targetType: 'Member',
            targetId: created.id,
            payload: { phone: created.phone },
          });
          return created;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return this.updateMemberIdentity(orgId, identity);
        }
        throw error;
      }
    }
    return this.updateMemberIdentity(orgId, identity);
  }

  private async updateMemberIdentity(orgId: string, identity: PhoneIdentity) {
    const current = await this.prisma.member.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
    });
    if (!current || current.status === 'DISABLED') {
      throw new ForbiddenException('账号已停用');
    }
    return this.prisma.member.update({
      where: { id: current.id },
      data: {
        wxOpenId: identity.openId,
        ...(identity.unionId ? { wxUnionId: identity.unionId } : {}),
      },
    });
  }
}
