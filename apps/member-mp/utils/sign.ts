import type { BenefitItem, MemberBenefit, SignFlowView, SignStatus } from './api';
import { dateText, dateTime, dayKey, formatYuan } from './format';

/** 会员权益和权益单签署页面共用的显示规则。只管怎么显示，不发请求。 */

export const STATUS_TEXT: Record<SignStatus, string> = {
  DRAFT: '准备中',
  PENDING: '待签署',
  SIGNED: '已签署',
  REJECTED: '已拒签',
  EXPIRED: '已过期',
  CANCELED: '已撤销',
};

/** 标签颜色：ok 绿、warn 橙、muted 灰。 */
export type Tone = 'ok' | 'warn' | 'muted';

export function statusTone(status: SignStatus): Tone {
  if (status === 'SIGNED') return 'ok';
  if (status === 'PENDING') return 'warn';
  return 'muted';
}

/** 签不了或签完时给会员看的白话说明。待签署时不需要说明。 */
export function statusNote(status: SignStatus): string {
  switch (status) {
    case 'PENDING':
      return '';
    case 'SIGNED':
      return '已签署，会员权益已生效。';
    case 'REJECTED':
      return '您已拒绝签署这份权益单。如有疑问，请联系门店。';
    case 'EXPIRED':
      return '这份权益单已过期。如需办理，请联系门店重新发起。';
    case 'CANCELED':
      return '门店已撤销这份权益单，不需要再签。';
    default:
      return '这份权益单还在准备，请稍后再来查看。';
  }
}

/** 规则是一段多行文字，按行拆开显示。 */
export function ruleLines(rules: string | null): string[] {
  return (rules ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---- 首页「会员权益」卡片

export interface BenefitSummary {
  items: BenefitItem[];
  /** 条目超过 3 条，去权益页看全部。 */
  more: boolean;
  statusText: string;
  tone: Tone;
  /** 还没生效时的一句提示。 */
  hint: string;
}

const HOME_ITEMS = 3;

/** 首页只摘第一个方案（已签的排最前）的前 3 条。一个方案都没有时返回 null，首页改显示储值说明。 */
export function homeBenefit(benefits: MemberBenefit[]): BenefitSummary | null {
  const first = benefits.find((benefit) => benefit.items.length > 0);
  if (!first) {
    return null;
  }
  const status = first.signFlow?.status;
  let hint = '';
  if (status === 'PENDING') {
    hint = '签署权益单后生效';
  } else if (status !== 'SIGNED') {
    hint = '到门店办理后生效';
  }
  return {
    items: first.items.slice(0, HOME_ITEMS),
    more: first.items.length > HOME_ITEMS,
    statusText: status === 'SIGNED' || status === 'PENDING' ? STATUS_TEXT[status] : '',
    tone: status ? statusTone(status) : 'muted',
    hint,
  };
}

// ---- 权益页

export interface BenefitCard {
  id: string;
  title: string;
  summary: string;
  items: BenefitItem[];
  ruleLines: string[];
  statusText: string;
  tone: Tone;
  flowId: string;
  /** sign：去签署；view：看签过（或签不了）的权益单；none：没有权益单，到店咨询。 */
  action: 'sign' | 'view' | 'none';
}

export function toBenefitCard(benefit: MemberBenefit): BenefitCard {
  const flow = benefit.signFlow;
  // 门店撤销的权益单当作没发起过，只在「我的权益单」里能看到。
  const live = flow && flow.status !== 'CANCELED' && flow.status !== 'DRAFT' ? flow : null;
  return {
    id: benefit.id,
    title: benefit.title,
    summary: benefit.summary ?? '',
    items: benefit.items,
    ruleLines: ruleLines(benefit.rules),
    statusText: live ? STATUS_TEXT[live.status] : '',
    tone: live ? statusTone(live.status) : 'muted',
    flowId: live ? live.id : '',
    action: !live ? 'none' : live.status === 'PENDING' ? 'sign' : 'view',
  };
}

// ---- 我的权益单

export interface SignRow {
  id: string;
  title: string;
  statusText: string;
  tone: Tone;
  sandbox: boolean;
  dateText: string;
}

export function toSignRow(flow: SignFlowView): SignRow {
  return {
    id: flow.id,
    title: flow.title,
    statusText: STATUS_TEXT[flow.status],
    tone: statusTone(flow.status),
    sandbox: flow.sandbox,
    dateText: flow.signedAt ? `签署于 ${dateText(flow.signedAt)}` : `发起于 ${dateText(flow.createdAt)}`,
  };
}

// ---- 签署页

export interface SignDetail {
  id: string;
  title: string;
  status: SignStatus;
  statusText: string;
  tone: Tone;
  sandbox: boolean;
  planTitle: string;
  summary: string;
  items: BenefitItem[];
  ruleLines: string[];
  hasPlan: boolean;
  canSign: boolean;
  hasPdf: boolean;
  timeLabel: string;
  timeText: string;
  note: string;
  /** 会员权益金额「1,000.00」，没有金额时为空。 */
  amountText: string;
  /** 这笔钱到没到余额。 */
  amountNote: string;
}

/** 签署后才充值：签之前说「签署后充值」，签完说「已充值」，没签成说「没有充值」。 */
export function amountNote(flow: Pick<SignFlowView, 'status' | 'recharged'>): string {
  if (flow.status === 'SIGNED') {
    return flow.recharged ? '已充值到你的余额' : '签署完成，正在充值到你的余额';
  }
  if (flow.status === 'PENDING' || flow.status === 'DRAFT') {
    return '签署完成后充值到你的余额';
  }
  return '这份权益单没有签署，金额没有充值';
}

export function toSignDetail(flow: SignFlowView): SignDetail {
  const plan = flow.benefitPlan;
  let note = statusNote(flow.status);
  if (flow.status === 'SIGNED' && !flow.hasPdf) {
    note = '已签署，会员权益已生效。合同正在归档，稍后可以在这里查看。';
  }
  return {
    id: flow.id,
    title: flow.title,
    status: flow.status,
    statusText: STATUS_TEXT[flow.status],
    tone: statusTone(flow.status),
    sandbox: flow.sandbox,
    planTitle: plan ? plan.title : '',
    summary: plan?.summary ?? '',
    items: plan ? plan.items : [],
    ruleLines: ruleLines(plan ? plan.rules : null),
    hasPlan: plan != null,
    canSign: flow.status === 'PENDING',
    hasPdf: flow.status === 'SIGNED' && flow.hasPdf,
    timeLabel: flow.signedAt ? '签署时间' : '发起时间',
    timeText: dateTime(flow.signedAt ?? flow.createdAt),
    note,
    amountText: flow.rechargeAmountCent != null ? formatYuan(flow.rechargeAmountCent) : '',
    amountNote: flow.rechargeAmountCent != null ? amountNote(flow) : '',
  };
}

// ---- 未签先引导

/** 本机记着今天已经引导过哪一份，免得每次回首页都被拉去签署页。 */
export const GUIDED_KEY = 'sign_guided';

export interface GuidedMark {
  id: string;
  day: string;
}

/** 有待签的权益单时，每天第一次进首页先打开签署页；换了一份新的也再引导一次。 */
export function shouldGuide(flowId: string, mark: unknown, now: Date = new Date()): boolean {
  if (!mark || typeof mark !== 'object') {
    return true;
  }
  const { id, day } = mark as Partial<GuidedMark>;
  return id !== flowId || day !== dayKey(now);
}

export function guidedMark(flowId: string, now: Date = new Date()): GuidedMark {
  return { id: flowId, day: dayKey(now) };
}

/** web-view 只打开 https 地址，防止被别的入口带着奇怪的链接打开。 */
export function isSignUrl(url: string): boolean {
  return /^https:\/\/[^\s/]+\//.test(url);
}
