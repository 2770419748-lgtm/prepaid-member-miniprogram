import {
  ConflictException,
  Injectable,
  NotFoundException,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, SignFlowStatus } from '@prisma/client';
import { AccessPrincipal } from '../auth/access-principal';
import { PageResult } from '../common/page';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { EsignClient } from './client/esign.client';
import { MemberSignFlowListQueryDto } from './dto/sign-flow.dto';
import {
  MemberBenefitView,
  memberSignFlowInclude,
  MemberSignFlowView,
  readBenefitContent,
  toMemberSignFlowView,
} from './esign.view';
import { SignFlowSyncService } from './sign-flow-sync.service';
import { SignFlowsService } from './sign-flows.service';

/** 签署顺序：已签的权益排最前，其次待签，最后是还没发起过的。 */
const BENEFIT_ORDER: Partial<Record<SignFlowStatus, number>> = {
  SIGNED: 0,
  PENDING: 1,
};

/** 会员自己的权益与签署。只看自己的，没有任何员工信息。 */
@Injectable()
export class MemberSignFlowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly esign: EsignClient,
    private readonly esignConfig: EsignConfigService,
    private readonly sync: SignFlowSyncService,
    private readonly flows: SignFlowsService,
  ) {}

  async list(
    principal: AccessPrincipal,
    query: MemberSignFlowListQueryDto,
  ): Promise<PageResult<MemberSignFlowView>> {
    const member = this.requireMember(principal);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // DRAFT 是店员刚点发起、还没在 e签宝建好的瞬间状态，会员不需要看到。
    const where: Prisma.SignFlowWhereInput = {
      orgId: member.orgId,
      memberId: member.id,
      status: query.status ?? { not: SignFlowStatus.DRAFT },
    };
    if (query.status === SignFlowStatus.DRAFT) {
      return { items: [], total: 0, page, pageSize };
    }
    const [total, rows] = await Promise.all([
      this.prisma.signFlow.count({ where }),
      this.prisma.signFlow.findMany({
        where,
        include: memberSignFlowInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toMemberSignFlowView), total, page, pageSize };
  }

  async get(principal: AccessPrincipal, id: string): Promise<MemberSignFlowView> {
    return toMemberSignFlowView(await this.requireOwn(principal, id));
  }

  /** 每次打开签署页前重新取链接。 */
  async signUrl(principal: AccessPrincipal, id: string): Promise<{ signUrl: string; sandbox: boolean }> {
    const flow = await this.requireOwn(principal, id);
    if (flow.status !== SignFlowStatus.PENDING || !flow.esignFlowId) {
      throw new ConflictException('这份权益单当前不能签署');
    }
    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: flow.memberId } });
    const signUrl = await this.esign.getSignUrl(flow.esignFlowId, member.phone, this.esignConfig.redirectUrl);
    await this.prisma.signFlow.updateMany({
      where: { id: flow.id, status: SignFlowStatus.PENDING },
      data: { signUrl },
    });
    return { signUrl, sandbox: flow.env === 'SANDBOX' };
  }

  /** 从签署页回来时调用。本地或内网环境收不到 e签宝回调，靠这里同步。 */
  async refresh(principal: AccessPrincipal, id: string): Promise<MemberSignFlowView> {
    const flow = await this.requireOwn(principal, id);
    await this.sync.sync(flow.id, 'refresh', 'keep');
    return this.get(principal, flow.id);
  }

  async pdf(principal: AccessPrincipal, id: string): Promise<StreamableFile> {
    const flow = await this.requireOwn(principal, id);
    return this.flows.readPdf(flow.pdfObjectKey, flow.title || flow.template.name);
  }

  /** 本公司在用的权益方案，加上会员签过或待签的方案（即使已下架）。 */
  async benefits(principal: AccessPrincipal): Promise<MemberBenefitView[]> {
    const member = this.requireMember(principal);
    const [plans, flows] = await Promise.all([
      this.prisma.benefitPlan.findMany({
        where: {
          orgId: member.orgId,
          OR: [
            { status: 'ACTIVE' },
            {
              templates: {
                some: {
                  signFlows: {
                    some: { memberId: member.id, status: { in: [SignFlowStatus.SIGNED, SignFlowStatus.PENDING] } },
                  },
                },
              },
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.signFlow.findMany({
        where: {
          memberId: member.id,
          orgId: member.orgId,
          status: { not: SignFlowStatus.DRAFT },
          template: { benefitPlanId: { not: null } },
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          template: { select: { benefitPlanId: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    // 每个方案取一份最能代表现状的流程：已签 > 待签 > 最近一份。
    const byPlan = new Map<string, (typeof flows)[number]>();
    for (const flow of flows) {
      const planId = flow.template.benefitPlanId!;
      const kept = byPlan.get(planId);
      if (!kept || (BENEFIT_ORDER[flow.status] ?? 9) < (BENEFIT_ORDER[kept.status] ?? 9)) {
        byPlan.set(planId, flow);
      }
    }
    const views = plans.map((plan): MemberBenefitView => {
      const flow = byPlan.get(plan.id);
      return {
        id: plan.id,
        title: plan.title,
        ...readBenefitContent(plan.contentJson),
        signFlow: flow ? { id: flow.id, status: flow.status, updatedAt: flow.updatedAt.toISOString() } : null,
      };
    });
    const rank = (view: MemberBenefitView) =>
      view.signFlow ? (BENEFIT_ORDER[view.signFlow.status] ?? 2) : 3;
    return views
      .map((view, index) => ({ view, index }))
      .sort((a, b) => rank(a.view) - rank(b.view) || a.index - b.index)
      .map(({ view }) => view);
  }

  private requireMember(principal: AccessPrincipal): { id: string; orgId: string } {
    if (principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    return { id: principal.sub, orgId: principal.orgId };
  }

  private async requireOwn(principal: AccessPrincipal, id: string) {
    const member = this.requireMember(principal);
    const flow = await this.prisma.signFlow.findUnique({ where: { id }, include: memberSignFlowInclude });
    if (
      !flow ||
      flow.orgId !== member.orgId ||
      flow.memberId !== member.id ||
      flow.status === SignFlowStatus.DRAFT
    ) {
      throw new NotFoundException('权益单不存在');
    }
    return flow;
  }
}
