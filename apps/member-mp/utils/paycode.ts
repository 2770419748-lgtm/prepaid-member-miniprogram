import type { LedgerItem, PayCodeState } from './api';
import { dateTime, formatChange, formatYuan } from './format';

/** 出示会员码时多久问一次服务端「码被扫了没、扣了没」。 */
export const POLL_MS = 2000;

/** 会员码页的几种样子。 */
export type CodeView = 'loading' | 'code' | 'scanned' | 'used' | 'blocked' | 'error';

/** 扣款成功后给会员看的那一笔。 */
export interface UsedView {
  entryId: string;
  amountText: string;
  balanceText: string;
  storeName: string;
  timeText: string;
}

/**
 * 拿到码的最新状态以后，页面接下来做什么：
 * wait 接着等；scanned 门店已扫，不再换码、等扣款结果；used 显示扣款结果；renew 换一张新码。
 */
export type NextStep =
  | { kind: 'wait' }
  | { kind: 'scanned'; storeName: string }
  | { kind: 'used'; used: UsedView }
  | { kind: 'renew' };

export function usedView(entry: LedgerItem): UsedView {
  return {
    entryId: entry.id,
    amountText: formatChange(entry.changeCent),
    balanceText: formatYuan(entry.balanceAfter),
    storeName: entry.storeName,
    timeText: dateTime(entry.createdAt),
  };
}

/** due：到了换新码的时间。码已被扫时不换，等门店扣完款。 */
export function nextStep(state: PayCodeState | null, due: boolean): NextStep {
  if (state && state.status === 'USED' && state.entry) {
    return { kind: 'used', used: usedView(state.entry) };
  }
  if (state && state.status === 'SCANNED') {
    return { kind: 'scanned', storeName: state.storeName ?? '' };
  }
  if (state && state.status === 'EXPIRED') {
    return { kind: 'renew' };
  }
  // 还没扫，或者暂时没问到（网络不好、码已被换掉）：到点就换码，否则接着等。
  return due ? { kind: 'renew' } : { kind: 'wait' };
}
