import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { toMemberView } from '../members/member.view';
import { PrismaService } from '../prisma/prisma.service';
import { AccessPrincipal } from './access-principal';
import { AccessTokenService } from './access-token.service';
import { WxPhoneLoginDto } from './dto/wx-phone-login.dto';
import { OrgResolver } from './org-resolver.service';
import { PhoneIdentity, WechatIdentityService } from './wechat/wechat-identity.service';

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
      include: { storeRoles: { include: { store: { select: { name: true } } } } },
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
    const roles = staff.storeRoles.map((role) => ({
      storeId: role.storeId,
      role: role.role,
      storeName: role.store.name,
    }));
    return {
      accessToken: this.tokens.sign({
        sub: staff.id,
        orgId,
        principalType: 'STAFF',
        roles: roles.map((role) => ({ storeId: role.storeId, role: role.role })),
      }),
      tokenType: 'Bearer' as const,
      expiresIn: this.tokens.expiresInSeconds,
      principalType: 'STAFF' as const,
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
      },
      roles: staff.storeRoles.map((role) => ({
        storeId: role.storeId,
        role: role.role,
        storeName: role.store.name,
      })),
    };
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
