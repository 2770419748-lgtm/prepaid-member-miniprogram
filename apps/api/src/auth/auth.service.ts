import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Staff, StaffStoreRole } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { toMemberView } from '../members/member.view';
import { PrismaService } from '../prisma/prisma.service';
import { AccessPrincipal } from './access-principal';
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
    const view = toMemberView(member);
    return {
      accessToken: this.tokens.sign({
        sub: member.id,
        orgId,
        principalType: 'MEMBER',
        roles: [],
      }),
      tokenType: 'Bearer' as const,
      expiresIn: this.tokens.expiresInSeconds,
      principalType: 'MEMBER' as const,
      needsCard: view.needsCard,
      member: view,
    };
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
    return this.issueStaffSession(staff);
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
    return this.issueStaffSession(staff);
  }

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

  private issueStaffSession(staff: StaffLoginRecord) {
    const roles = staff.storeRoles.map((role) => ({
      storeId: role.storeId,
      role: role.role,
      storeName: role.store.name,
    }));
    return {
      accessToken: this.tokens.sign({
        sub: staff.id,
        orgId: staff.orgId,
        principalType: 'STAFF' as const,
        roles: roles.map((role) => ({ storeId: role.storeId, role: role.role })),
      }),
      tokenType: 'Bearer' as const,
      expiresIn: this.tokens.expiresInSeconds,
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
