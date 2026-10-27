import {
  BenefitPlanStatus,
  ContractTemplateStatus,
  Prisma,
  SignEnv,
  SignFlowStatus,
} from '@prisma/client';

export interface BenefitItem {
  title: string;
  detail: string | null;
}

/** BenefitPlan.contentJson 的结构。 */
export interface BenefitContent {
  summary: string | null;
  items: BenefitItem[];
  rules: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 读库里的权益内容。早期手填的 JSON 格式不对时按空处理，不报错。 */
export function readBenefitContent(value: Prisma.JsonValue | null): BenefitContent {
  if (!isRecord(value)) {
    return { summary: null, items: [], rules: null };
  }
  const items: BenefitItem[] = [];
  for (const item of Array.isArray(value.items) ? (value.items as unknown[]) : []) {
    if (isRecord(item) && typeof item.title === 'string' && item.title.trim()) {
      items.push({
        title: item.title,
        detail: typeof item.detail === 'string' && item.detail ? item.detail : null,
      });
    }
  }
  return {
    summary: typeof value.summary === 'string' && value.summary ? value.summary : null,
    items,
    rules: typeof value.rules === 'string' && value.rules ? value.rules : null,
  };
}

export function toBenefitContentJson(content: BenefitContent): Prisma.InputJsonObject {
  return {
    summary: content.summary,
    items: content.items.map((item) => ({ title: item.title, detail: item.detail })),
    rules: content.rules,
  };
}

export interface BenefitPlanView extends BenefitContent {
  id: string;
  title: string;
  status: BenefitPlanStatus;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}

export const benefitPlanInclude = {
  _count: { select: { templates: true } },
} satisfies Prisma.BenefitPlanInclude;

export function toBenefitPlanView(
  plan: Prisma.BenefitPlanGetPayload<{ include: typeof benefitPlanInclude }>,
): BenefitPlanView {
  return {
    id: plan.id,
    title: plan.title,
    ...readBenefitContent(plan.contentJson),
    status: plan.status,
    templateCount: plan._count.templates,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export interface ContractTemplateView {
  id: string;
  name: string;
  esignTemplateId: string;
  status: ContractTemplateStatus;
  benefitPlan: { id: string; title: string } | null;
  memberSignKeyword: string;
  sealKeyword: string;
  createdAt: string;
  updatedAt: string;
}

export const contractTemplateInclude = {
  benefitPlan: { select: { id: true, title: true } },
} satisfies Prisma.ContractTemplateInclude;

export function toContractTemplateView(
  template: Prisma.ContractTemplateGetPayload<{ include: typeof contractTemplateInclude }>,
): ContractTemplateView {
  return {
    id: template.id,
    name: template.name,
    esignTemplateId: template.esignTemplateId,
    status: template.status,
    benefitPlan: template.benefitPlan,
    memberSignKeyword: template.memberSignKeyword,
    sealKeyword: template.sealKeyword,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export const signFlowInclude = {
  member: { select: { id: true, phone: true, name: true } },
  template: {
    select: { id: true, name: true, benefitPlan: { select: { id: true, title: true } } },
  },
  store: { select: { id: true, name: true } },
  initiator: { select: { id: true, name: true } },
} satisfies Prisma.SignFlowInclude;

export type SignFlowRecord = Prisma.SignFlowGetPayload<{ include: typeof signFlowInclude }>;

/** 店员看到的签署流程。 */
export interface SignFlowView {
  id: string;
  title: string;
  status: SignFlowStatus;
  env: SignEnv;
  member: { id: string; phone: string; name: string | null };
  template: { id: string; name: string };
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 只在待签署时有值。 */
  signUrl: string | null;
  hasPdf: boolean;
  signedAt: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSignFlowView(flow: SignFlowRecord): SignFlowView {
  return {
    id: flow.id,
    title: flow.title || flow.template.name,
    status: flow.status,
    env: flow.env,
    member: flow.member,
    template: { id: flow.template.id, name: flow.template.name },
    benefitPlan: flow.template.benefitPlan,
    store: flow.store,
    initiator: flow.initiator,
    signUrl: flow.status === SignFlowStatus.PENDING ? flow.signUrl : null,
    hasPdf: flow.pdfObjectKey != null,
    signedAt: flow.signedAt?.toISOString() ?? null,
    syncedAt: flow.syncedAt?.toISOString() ?? null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

export const memberSignFlowInclude = {
  template: {
    select: {
      name: true,
      benefitPlan: { select: { id: true, title: true, contentJson: true } },
    },
  },
} satisfies Prisma.SignFlowInclude;

export type MemberSignFlowRecord = Prisma.SignFlowGetPayload<{ include: typeof memberSignFlowInclude }>;

/** 会员看到的签署流程。没有员工、门店内部信息，也不直接给签署链接。 */
export interface MemberSignFlowView {
  id: string;
  title: string;
  status: SignFlowStatus;
  env: SignEnv;
  /** 沙箱签署，界面标「测试签署」。 */
  sandbox: boolean;
  benefitPlan: ({ id: string; title: string } & BenefitContent) | null;
  hasPdf: boolean;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMemberSignFlowView(flow: MemberSignFlowRecord): MemberSignFlowView {
  const plan = flow.template.benefitPlan;
  return {
    id: flow.id,
    title: flow.title || flow.template.name,
    status: flow.status,
    env: flow.env,
    sandbox: flow.env === SignEnv.SANDBOX,
    benefitPlan: plan ? { id: plan.id, title: plan.title, ...readBenefitContent(plan.contentJson) } : null,
    hasPdf: flow.pdfObjectKey != null,
    signedAt: flow.signedAt?.toISOString() ?? null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

/** 会员首页、权益页用。 */
export interface MemberBenefitView extends BenefitContent {
  id: string;
  title: string;
  signFlow: { id: string; status: SignFlowStatus; updatedAt: string } | null;
}
