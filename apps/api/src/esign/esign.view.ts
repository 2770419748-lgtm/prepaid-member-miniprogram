import {
  BenefitPlanStatus,
  ContractTemplateStatus,
  Prisma,
  SignEnv,
  SignFlowStatus,
  SignKind,
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

/** 协议单照片：只列没删的，按上传先后。 */
const activePhotos = {
  where: { removedAt: null },
  select: { id: true, createdAt: true },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.SignFlow$photosArgs;

/** 那笔充值有没有被冲正（店长或超管记错了账撤回来）。 */
const rechargeEntryReversal = {
  select: { reversedBy: { select: { id: true } } },
} satisfies Prisma.LedgerEntryDefaultArgs;

export const signFlowInclude = {
  member: { select: { id: true, phone: true, name: true } },
  template: {
    select: { id: true, name: true, benefitPlan: { select: { id: true, title: true } } },
  },
  benefitPlan: { select: { id: true, title: true } },
  store: { select: { id: true, name: true } },
  initiator: { select: { id: true, name: true } },
  photos: activePhotos,
  rechargeEntry: rechargeEntryReversal,
} satisfies Prisma.SignFlowInclude;

export type SignFlowRecord = Prisma.SignFlowGetPayload<{ include: typeof signFlowInclude }>;

export interface AgreementPhotoView {
  id: string;
  createdAt: string;
}

function toPhotoViews(photos: { id: string; createdAt: Date }[]): AgreementPhotoView[] {
  return photos.map((photo) => ({ id: photo.id, createdAt: photo.createdAt.toISOString() }));
}

/** 标题：发起时的快照；老数据没有快照时用模板名，纸质协议单用方案名。 */
function flowTitle(flow: { title: string; template: { name: string } | null }, planTitle: string | undefined): string {
  return flow.title || flow.template?.name || planTitle || PAPER_AGREEMENT_TITLE;
}

/** 纸质协议单没选权益方案时的标题。 */
export const PAPER_AGREEMENT_TITLE = '会员协议单';

/** 店员看到的签署流程。 */
export interface SignFlowView {
  id: string;
  title: string;
  /** ESIGN 电子签；PAPER 纸质协议单（拍照上传）。 */
  kind: SignKind;
  status: SignFlowStatus;
  env: SignEnv;
  /** 电子签沙箱，界面标「测试签署」。纸质协议单永远是 false。 */
  sandbox: boolean;
  member: { id: string; phone: string; name: string | null };
  /** 电子签用的模板。纸质协议单为空。 */
  template: { id: string; name: string } | null;
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 只在待签署时有值。 */
  signUrl: string | null;
  /** 会员权益金额（分），签完充值到余额。不带金额的权益单为空。 */
  rechargeAmountCent: number | null;
  /** 签完后自动记的那笔充值流水。带金额、已签署但还没充上时为空。 */
  rechargeEntryId: string | null;
  /** 那笔充值已经被冲正（钱撤回了）。 */
  rechargeReversed: boolean;
  hasPdf: boolean;
  /** 纸质协议单的照片（没删的）。电子签为空数组。 */
  photos: AgreementPhotoView[];
  signedAt: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSignFlowView(flow: SignFlowRecord): SignFlowView {
  const plan = flow.benefitPlan ?? flow.template?.benefitPlan ?? null;
  return {
    id: flow.id,
    title: flowTitle(flow, plan?.title),
    kind: flow.kind,
    status: flow.status,
    env: flow.env,
    sandbox: flow.kind === SignKind.ESIGN && flow.env === SignEnv.SANDBOX,
    member: flow.member,
    template: flow.template ? { id: flow.template.id, name: flow.template.name } : null,
    benefitPlan: plan,
    store: flow.store,
    initiator: flow.initiator,
    signUrl: flow.status === SignFlowStatus.PENDING ? flow.signUrl : null,
    rechargeAmountCent: flow.rechargeAmountCent,
    rechargeEntryId: flow.rechargeEntryId,
    rechargeReversed: flow.rechargeEntry?.reversedBy != null,
    hasPdf: flow.pdfObjectKey != null,
    photos: toPhotoViews(flow.photos),
    signedAt: flow.signedAt?.toISOString() ?? null,
    syncedAt: flow.syncedAt?.toISOString() ?? null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

const memberPlanSelect = { id: true, title: true, contentJson: true } satisfies Prisma.BenefitPlanSelect;

export const memberSignFlowInclude = {
  template: {
    select: {
      name: true,
      benefitPlan: { select: memberPlanSelect },
    },
  },
  benefitPlan: { select: memberPlanSelect },
  photos: activePhotos,
  rechargeEntry: rechargeEntryReversal,
} satisfies Prisma.SignFlowInclude;

export type MemberSignFlowRecord = Prisma.SignFlowGetPayload<{ include: typeof memberSignFlowInclude }>;

/** 会员看到的签署流程。没有员工、门店内部信息，也不直接给签署链接。 */
export interface MemberSignFlowView {
  id: string;
  title: string;
  /** ESIGN 电子签；PAPER 在门店签的纸质协议单，照片在 photos 里。 */
  kind: SignKind;
  status: SignFlowStatus;
  env: SignEnv;
  /** 电子签沙箱，界面标「测试签署」。纸质协议单永远是 false。 */
  sandbox: boolean;
  benefitPlan: ({ id: string; title: string } & BenefitContent) | null;
  /** 会员权益金额（分），签完后充值到余额。不带金额的权益单为空。 */
  rechargeAmountCent: number | null;
  /** 这笔钱已经充进余额。 */
  recharged: boolean;
  /** 充进去的钱后来被门店撤回了。 */
  rechargeReversed: boolean;
  hasPdf: boolean;
  photos: AgreementPhotoView[];
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMemberSignFlowView(flow: MemberSignFlowRecord): MemberSignFlowView {
  const plan = flow.benefitPlan ?? flow.template?.benefitPlan ?? null;
  return {
    id: flow.id,
    title: flowTitle(flow, plan?.title),
    kind: flow.kind,
    status: flow.status,
    env: flow.env,
    sandbox: flow.kind === SignKind.ESIGN && flow.env === SignEnv.SANDBOX,
    benefitPlan: plan ? { id: plan.id, title: plan.title, ...readBenefitContent(plan.contentJson) } : null,
    rechargeAmountCent: flow.rechargeAmountCent,
    recharged: flow.rechargeEntryId != null,
    rechargeReversed: flow.rechargeEntry?.reversedBy != null,
    hasPdf: flow.pdfObjectKey != null,
    photos: toPhotoViews(flow.photos),
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
