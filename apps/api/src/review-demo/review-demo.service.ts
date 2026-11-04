import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { hashPassword } from '../auth/password';
import { isSuperAdmin } from '../auth/staff-access';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateReviewPassword,
  REVIEW_DEMO_ACCOUNT,
  REVIEW_DEMO_DAYS,
  REVIEW_STAFF_PHONE,
  reviewDemoOpen,
} from './review-demo.constants';
import { createReviewDemoOrg } from './review-demo.seed';

export interface ReviewDemoView {
  enabled: boolean;
  /** 开着时是自动关闭的时间；关着时是上次的截止时间（可能为空）。 */
  until: string | null;
  account: string;
  days: number;
  /** 演示公司建好没有，建好了有几家店、几位会员。 */
  demo: { stores: number; members: number } | null;
}

export interface ReviewDemoSecret extends ReviewDemoView {
  /** 只在打开和换密码时返回这一次，库里只存哈希。 */
  password: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 超级管理员在商家后台打开、关闭审核体验入口。登录和小程序那边的开关查询在 AuthService。 */
@Injectable()
export class ReviewDemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async status(actor: AccessPrincipal): Promise<ReviewDemoView> {
    await this.requireRealOrg(actor);
    return this.view(actor.orgId);
  }

  /** 打开 7 天并换一个新密码。已经开着就从现在起再算 7 天（顺带换密码，旧密码作废）。 */
  async open(actor: AccessPrincipal): Promise<ReviewDemoSecret> {
    const org = await this.requireRealOrg(actor);
    const now = new Date();
    const until = new Date(now.getTime() + REVIEW_DEMO_DAYS * DAY_MS);
    const password = generateReviewPassword();
    const passwordHash = await hashPassword(password);
    const wasOpen = reviewDemoOpen(org.reviewDemoUntil, now);

    await this.prisma.$transaction(async (tx) => {
      // 锁住这一行，两个超管同时点打开不会建出两家演示公司。
      await tx.$queryRaw`SELECT id FROM orgs WHERE id = ${org.id} FOR UPDATE`;
      const current = await tx.org.findUniqueOrThrow({
        where: { id: org.id },
        select: { demo: { select: { id: true } } },
      });
      const created = !current.demo;
      const demoOrgId = current.demo?.id ?? (await createReviewDemoOrg(tx, org.id, now));
      await tx.org.update({
        where: { id: org.id },
        data: { reviewDemoUntil: until, reviewDemoPasswordHash: passwordHash },
      });
      if (!wasOpen) {
        // 上一轮审核留下的登录不能跟着复活。
        await this.expireDemoSessions(tx, demoOrgId);
      }
      await tx.staff.updateMany({
        where: { orgId: demoOrgId, phone: REVIEW_STAFF_PHONE },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.write(tx, {
        orgId: org.id,
        actorStaffId: actor.sub,
        action: AuditAction.ReviewDemoOpen,
        targetType: 'Org',
        targetId: demoOrgId,
        payload: { until: until.toISOString(), extended: wasOpen, demoCreated: created },
      });
    });
    return { ...(await this.view(org.id)), password };
  }

  /** 开着的时候换个密码（比如密码丢了）。截止时间不变，已经登录的审核员不受影响。 */
  async rotatePassword(actor: AccessPrincipal): Promise<ReviewDemoSecret> {
    const org = await this.requireRealOrg(actor);
    if (!reviewDemoOpen(org.reviewDemoUntil)) {
      throw new ConflictException('审核体验入口没有打开，请先打开');
    }
    const password = generateReviewPassword();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.org.update({ where: { id: org.id }, data: { reviewDemoPasswordHash: passwordHash } });
      await this.audit.write(tx, {
        orgId: org.id,
        actorStaffId: actor.sub,
        action: AuditAction.ReviewDemoPassword,
        targetType: 'Org',
        targetId: org.demo?.id ?? org.id,
      });
    });
    return { ...(await this.view(org.id)), password };
  }

  /** 审完关掉：入口马上消失，审核员已有的登录马上失效。演示数据留着，下次打开接着用。 */
  async close(actor: AccessPrincipal): Promise<ReviewDemoView> {
    const org = await this.requireRealOrg(actor);
    if (!reviewDemoOpen(org.reviewDemoUntil)) {
      throw new ConflictException('审核体验入口已经是关闭的');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.org.update({
        where: { id: org.id },
        data: { reviewDemoUntil: new Date(), reviewDemoPasswordHash: null },
      });
      if (org.demo) {
        await this.expireDemoSessions(tx, org.demo.id);
      }
      await this.audit.write(tx, {
        orgId: org.id,
        actorStaffId: actor.sub,
        action: AuditAction.ReviewDemoClose,
        targetType: 'Org',
        targetId: org.demo?.id ?? org.id,
      });
    });
    return this.view(org.id);
  }

  private async expireDemoSessions(tx: Prisma.TransactionClient, demoOrgId: string): Promise<void> {
    await tx.staff.updateMany({ where: { orgId: demoOrgId }, data: { sessionVersion: { increment: 1 } } });
    await tx.member.updateMany({ where: { orgId: demoOrgId }, data: { sessionVersion: { increment: 1 } } });
  }

  private async requireRealOrg(actor: AccessPrincipal) {
    if (!isSuperAdmin(actor.roles)) {
      throw new ForbiddenException('只有超级管理员可以管理审核体验入口');
    }
    const org = await this.prisma.org.findUnique({
      where: { id: actor.orgId },
      select: { id: true, demoOfId: true, reviewDemoUntil: true, demo: { select: { id: true } } },
    });
    if (!org || org.demoOfId) {
      throw new ForbiddenException('演示公司不能管理审核体验入口');
    }
    return org;
  }

  private async view(orgId: string): Promise<ReviewDemoView> {
    const org = await this.prisma.org.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        reviewDemoUntil: true,
        reviewDemoPasswordHash: true,
        demo: { select: { _count: { select: { stores: true, members: true } } } },
      },
    });
    return {
      enabled: reviewDemoOpen(org.reviewDemoUntil) && !!org.reviewDemoPasswordHash,
      until: org.reviewDemoUntil?.toISOString() ?? null,
      account: REVIEW_DEMO_ACCOUNT,
      days: REVIEW_DEMO_DAYS,
      demo: org.demo ? { stores: org.demo._count.stores, members: org.demo._count.members } : null,
    };
  }
}
