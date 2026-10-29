import type { MyStoresResult, SignFlow, SignFlowStatus } from './types';

/**
 * 开单一条龙：输顾客手机号 → 填会员权益金额、选权益单 → 顾客扫码签合同 → 签完自动充值到账 → 顾客扫会员小程序码登录。
 * 坤总 2026-10-29 定：签完合同才到账，生成合同时不动余额。
 */
export type OrderStep = 'phone' | 'benefit' | 'sign' | 'done';

const STEPS: { key: OrderStep; label: string }[] = [
  { key: 'phone', label: '手机号' },
  { key: 'benefit', label: '填权益' },
  { key: 'sign', label: '签合同' },
  { key: 'done', label: '到账' },
];

export interface StepDot {
  key: OrderStep;
  label: string;
  /** 走过的显示勾，当前的高亮。 */
  state: 'done' | 'current' | 'todo';
  index: number;
}

export function stepDots(current: OrderStep): StepDot[] {
  const at = STEPS.findIndex((step) => step.key === current);
  return STEPS.map((step, index) => ({
    ...step,
    index: index + 1,
    state: index < at ? 'done' : index === at ? 'current' : 'todo',
  }));
}

/** 签署页隔多久问一次签好没有；自动问十分钟，之后要店员点「刷新状态」。 */
export const POLL_MS = 4000;
export const POLL_LIMIT_MS = 10 * 60 * 1000;

export type SignProgress =
  | { kind: 'waiting' }
  | { kind: 'recharging' }
  | { kind: 'done' }
  | { kind: 'ended'; title: string; text: string };

const ENDED: Partial<Record<SignFlowStatus, { title: string; text: string }>> = {
  REJECTED: { title: '顾客拒签了这份合同', text: '会员权益金额没有充值。和顾客确认后可以重新开单。' },
  EXPIRED: { title: '合同已过期', text: '顾客没有在有效期内签署，会员权益金额没有充值。请重新开单。' },
  CANCELED: { title: '合同已撤销', text: '这份合同已经撤销，会员权益金额没有充值。' },
};

/** 合同走到哪一步：等顾客签、签了正在充值、充好了、没签成。 */
export function signProgress(flow: Pick<SignFlow, 'status' | 'rechargeAmountCent' | 'rechargeEntryId'>): SignProgress {
  if (flow.status === 'SIGNED') {
    return flow.rechargeAmountCent != null && !flow.rechargeEntryId ? { kind: 'recharging' } : { kind: 'done' };
  }
  const ended = ENDED[flow.status];
  return ended ? { kind: 'ended', ...ended } : { kind: 'waiting' };
}

/** 和服务端一致：超级管理员，或发起这份合同的门店的店长，才能撤销。 */
export function canCancelFlow(flow: Pick<SignFlow, 'status' | 'store'>, access: MyStoresResult): boolean {
  if (flow.status !== 'PENDING') {
    return false;
  }
  if (access.unrestricted) {
    return true;
  }
  return access.stores.some((store) => store.id === flow.store?.id && store.role === 'STORE_MANAGER');
}

/** 去开单页：带手机号从头开始，带会员号直接填权益，带合同号接着签。 */
export function orderUrl(from: { phone?: string; memberId?: string; flowId?: string } = {}): string {
  const query = (Object.keys(from) as (keyof typeof from)[])
    .filter((key) => from[key])
    .map((key) => `${key}=${encodeURIComponent(from[key] as string)}`);
  return query.length ? `/pages/order/order?${query.join('&')}` : '/pages/order/order';
}

/** 本机演示时画的码，写明是演示，扫了也打不开。 */
export const DEMO_APP_CODE_TEXT = '储值会员小程序（本机演示码，正式上线后换成小程序码）';
