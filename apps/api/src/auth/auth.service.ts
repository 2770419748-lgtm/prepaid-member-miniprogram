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
import { REVIEW_DEMO_ACCOUNT, REVIEW_STAFF_PHONE, reviewDemoOpen } from '../review-demo/review-demo.constants';
import { AccessPrincipal, LoginMethod } from './access-principal';
import { AccessTokenService } from './access-token.service';
import { ReviewDemoLoginDto } from './dto/review-demo-login.dto';
import { ChangeStaffPasswordDto, StaffPasswordLoginDto } from './dto/staff-password.dto';
import { WxPhoneLoginDto } from './dto/wx-phone-login.dto';
import { OrgResolver } from './org-resolver.service';
import { hashPassword, lockActive, lockAfterFailure, passwordMatches } from './password';
import { assertMainlandMobile, normalizePhone } from './phone';
import { PhoneIdentity, WechatIdentityService } from './wechat/wechat-identity.service';

/** 停用的会员登录小程序时看到的话：顾客要知道是会员卡停了、该去问门店。 */
export const MEMBER_DISABLED = '会员卡已停用，如有疑问请联系门店';

const staffLoginInclude = {
  storeRoles: { include: { store: { select: { name: true } } } },
} satisfies Prisma.StaffInclude;

type StaffLoginRecord = Staff & {
  storeRoles: (StaffStoreRole & { store: { name: string } })[];
};

/** 建会员或更新会员微信标识用。员工切到会员卡时没有新换的微信凭证，openId 可能为空。 */
type MemberIdentity = Omit<PhoneIdentity, 'openId'> & { openId: string | null };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgs: OrgResolver,
    private readonly wechat: WechatIdentityService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditLogWriter,
  ) {}

  /**
   * 小程序登录（会员和员工共用一个小程序，2026-11-04 合并）：微信手机号只换一次，
   * 这个手机号在本公司是在职员工就发员工登录，小程序直接进工作台；否则按会员登录（第一次登录就建会员）。
   * 员工被停用后再登录就只是会员。员工要看自己的会员卡走 memberSessionForStaff，不在这里顺手建会员。
   */
  async loginWithWechatPhone(dto: WxPhoneLoginDto) {
    const identity = await this.wechat.resolve(dto);
    const orgId = await this.orgs.resolve(dto.orgId);
    const staff = await this.prisma.staff.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
      include: staffLoginInclude,
    });
    if (staff && staff.status === 'ACTIVE') {
      return this.signInStaffByWechat(staff, identity);
    }
    const member = await this.saveMember(orgId, identity);
    return this.issueMemberSession(member);
  }

  /** 只按会员登录。小程序用 loginWithWechatPhone；这个留给脚本和测试。 */
  async loginMember(dto: WxPhoneLoginDto) {
    const identity = await this.wechat.resolve(dto);
    const orgId = await this.orgs.resolve(dto.orgId);
    const member = await this.saveMember(orgId, identity);
    return this.issueMemberSession(member);
  }

  /**
   * 工作台「切到我的会员卡」：员工的手机号在小程序登录时已经由微信验证过，直接换一张这个手机号的会员登录，
   * 不用再点一次手机号授权。只认小程序（微信手机号）登录的员工，网页后台的密码登录不行。
   * 这个手机号还没有会员就建一个（和会员第一次登录一样，没开卡）；会员被停用则拒绝。
   */
  async memberSessionForStaff(principal: AccessPrincipal) {
    if (principal.principalType !== 'STAFF' || principal.session?.method !== 'WECHAT') {
      throw new ForbiddenException('请在小程序里用微信手机号登录后再切换');
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: principal.sub } });
    if (
      !staff ||
      staff.orgId !== principal.orgId ||
      staff.status !== 'ACTIVE' ||
      staff.sessionVersion !== principal.session.version
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const member = await this.saveMember(staff.orgId, {
      phone: staff.phone,
      openId: staff.wxOpenId,
      unionId: null,
    });
    return this.issueMemberSession(member);
  }

  /**
   * 会员小程序续期：拿还没过期的登录换一张新的，有效期从现在重新算（默认 30 天）。
   * 小程序每天打开时调一次，常用就一直不用重新登录。会员被停用、被换手机号后旧登录在守卫里就被拒（401）。
   */
  async renewMemberSession(principal: AccessPrincipal) {
    if (principal.principalType !== 'MEMBER') {
      throw new ForbiddenException('只有会员小程序的登录可以续期');
    }
    const member = await this.prisma.member.findUnique({ where: { id: principal.sub } });
    if (
      !member ||
      member.orgId !== principal.orgId ||
      member.status !== 'ACTIVE' ||
      member.sessionVersion !== principal.session?.version
    ) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return this.issueMemberSession(member);
  }

  /** 只按员工登录，不是员工就拒绝。小程序用 loginWithWechatPhone；这个留给脚本和测试。 */
  async loginStaff(dto: WxPhoneLoginDto) {
    const identity = await this.wechat.resolve(dto);
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
    return this.signInStaffByWechat(staff, identity);
  }

  private async signInStaffByWechat(staff: StaffLoginRecord, identity: PhoneIdentity) {
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
   * 小程序登录页问要不要显示「审核体验入口」。只回开或关，别的什么都不透露；出任何问题都当关着。
   */
  async reviewDemoEnabled(orgId?: string): Promise<{ enabled: boolean }> {
    const org = await this.reviewDemoOrg(orgId);
    return { enabled: !!org && this.reviewDemoUsable(org) };
  }

  /**
   * 审核体验入口登录：账号固定、密码是超级管理员打开入口时生成的。登进去的是演示公司里的审核员
   * （两家演示门店的店长），和员工微信手机号登录一样能用工作台、切到自己的会员卡，碰不到真实公司的数据。
   * 登录方式记成 WECHAT（都是小程序里的登录），所以能续期、能切会员卡；入口一关，守卫里马上失效。
   * 连续输错 5 次锁 15 分钟，和网页后台密码一样。
   */
  async loginReviewDemo(dto: ReviewDemoLoginDto) {
    const org = await this.reviewDemoOrg(dto.orgId);
    if (!org || !this.reviewDemoUsable(org) || !org.demo) {
      throw new ForbiddenException('审核体验入口没有打开');
    }
    const demoOrgId = org.demo.id;
    const staff = await this.prisma.staff.findUnique({
      where: { orgId_phone: { orgId: demoOrgId, phone: REVIEW_STAFF_PHONE } },
      include: staffLoginInclude,
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new ForbiddenException('审核体验账号不可用，请联系商家');
    }
    if (lockActive(staff.lockedUntil, new Date())) {
      throw new ForbiddenException('登录已锁定，请 15 分钟后再试');
    }
    const accountOk = dto.account.trim().toLowerCase() === REVIEW_DEMO_ACCOUNT;
    const matches = await passwordMatches(dto.password, org.reviewDemoPasswordHash);
    if (!accountOk || !matches) {
      await this.recordPasswordFailure(staff.id, '审核账号或密码错误');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: staff.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.write(tx, {
        orgId: org.id,
        action: AuditAction.ReviewDemoLogin,
        targetType: 'Org',
        targetId: demoOrgId,
      });
    });
    return this.issueStaffSession(staff, 'WECHAT');
  }

  private async reviewDemoOrg(requestedOrgId?: string) {
    let orgId: string;
    try {
      orgId = await this.orgs.resolve(requestedOrgId);
    } catch {
      return null;
    }
    return this.prisma.org.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        reviewDemoUntil: true,
        reviewDemoPasswordHash: true,
        demo: { select: { id: true, status: true } },
      },
    });
  }

  private reviewDemoUsable(org: {
    reviewDemoUntil: Date | null;
    reviewDemoPasswordHash: string | null;
    demo: { status: string } | null;
  }): boolean {
    return reviewDemoOpen(org.reviewDemoUntil) && !!org.reviewDemoPasswordHash && org.demo?.status === 'ACTIVE';
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
      // 这个手机号是不是本公司在职员工：是的话小程序「我的」页显示「进入工作台」（重新登录一次就进）。
      const staff = await this.prisma.staff.findUnique({
        where: { orgId_phone: { orgId: member.orgId, phone: member.phone } },
        select: { status: true },
      });
      return {
        principalType: 'MEMBER' as const,
        needsCard: view.needsCard,
        member: view,
        workbench: staff?.status === 'ACTIVE',
      };
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
      session: { version: member.sessionVersion, method: 'WECHAT' },
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

  private async recordPasswordFailure(staffId: string, message = '手机号或密码错误'): Promise<never> {
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
    throw new UnauthorizedException(message);
  }

  /** 员工切到会员卡时没有新的微信凭证，微信标识可能为空，为空就不改库里已有的。 */
  private async saveMember(orgId: string, identity: MemberIdentity) {
    const existing = await this.prisma.member.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
    });
    if (existing?.status === 'DISABLED') {
      throw new ForbiddenException(MEMBER_DISABLED);
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

  private async updateMemberIdentity(orgId: string, identity: MemberIdentity) {
    const current = await this.prisma.member.findUnique({
      where: { orgId_phone: { orgId, phone: identity.phone } },
    });
    if (!current || current.status === 'DISABLED') {
      throw new ForbiddenException(MEMBER_DISABLED);
    }
    return this.prisma.member.update({
      where: { id: current.id },
      data: {
        ...(identity.openId ? { wxOpenId: identity.openId } : {}),
        ...(identity.unionId ? { wxUnionId: identity.unionId } : {}),
      },
    });
  }
}
