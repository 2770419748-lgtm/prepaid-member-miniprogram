import { ledgerTitle } from './labels';
import { formatCent, formatChange } from './money';
import { maskPhone } from './phone';
import { dayKey, dayLabel, formatClock } from './time';
import type { LedgerEntry, MyStore, MyStoresResult } from './types';

/** 列表里一行流水需要的显示文字，页面不再自己拼。 */
export interface LedgerRow {
  id: string;
  title: string;
  member: string;
  meta: string;
  change: string;
  tone: 'plus' | 'minus';
  balanceAfter: string;
  reversed: boolean;
  isReversal: boolean;
}

export interface LedgerDay {
  key: string;
  label: string;
  rows: LedgerRow[];
}

export function memberLabel(phone: string, name: string | null): string {
  return name ? `${maskPhone(phone)} ${name}` : maskPhone(phone);
}

export function toLedgerRow(entry: LedgerEntry, options: { showStore?: boolean } = {}): LedgerRow {
  const meta = [formatClock(entry.createdAt)];
  if (options.showStore) {
    meta.push(entry.storeName);
  }
  if (entry.operatorName) {
    meta.push(entry.operatorName);
  }
  return {
    id: entry.id,
    title: ledgerTitle(entry.type, entry.changeCent),
    member: memberLabel(entry.memberPhone, entry.memberName),
    meta: meta.join(' · '),
    change: formatChange(entry.changeCent),
    tone: entry.changeCent >= 0 ? 'plus' : 'minus',
    balanceAfter: formatCent(entry.balanceAfter),
    reversed: entry.reversedById != null,
    isReversal: entry.type === 'REVERSAL',
  };
}

/** 按北京时间的日期分组，保持接口返回的先后顺序（新的在前）。 */
export function groupByDay(
  entries: LedgerEntry[],
  options: { showStore?: boolean; now?: Date } = {},
): LedgerDay[] {
  const days: LedgerDay[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(key, options.now), rows: [] };
      days.push(day);
    }
    day.rows.push(toLedgerRow(entry, options));
  }
  return days;
}

/**
 * 冲正权限与服务端一致：超级管理员，或这笔流水所在门店的店长。
 * 冲正流水本身、已经冲过的流水都不能再冲。
 */
export function canReverse(entry: LedgerEntry, access: MyStoresResult): boolean {
  if (entry.type === 'REVERSAL' || entry.reversedById) {
    return false;
  }
  if (access.unrestricted) {
    return true;
  }
  return access.stores.some((store) => store.id === entry.storeId && store.role === 'STORE_MANAGER');
}

/** 选当前门店：沿用上次选的在营门店，否则取第一家在营门店。都停用时返回空。 */
export function pickStore(stores: MyStore[], preferredId: string | null): MyStore | null {
  const active = stores.filter((store) => store.status === 'ACTIVE');
  return active.find((store) => store.id === preferredId) ?? active[0] ?? null;
}
