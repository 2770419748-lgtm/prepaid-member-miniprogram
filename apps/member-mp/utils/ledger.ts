import type { LedgerItem } from './api';
import { clock, dateTime, dayKey, dayLabel, formatChange, formatYuan } from './format';

/**
 * 会员看到的名称。「冲正」对会员说成「撤销」：消费被撤销钱回到余额，充值被撤销钱从余额扣回。
 */
export function entryTitle(entry: Pick<LedgerItem, 'type' | 'changeCent'>): string {
  if (entry.type === 'RECHARGE') {
    return '充值';
  }
  if (entry.type === 'CONSUME') {
    return '消费';
  }
  return entry.changeCent > 0 ? '消费撤销' : '充值撤销';
}

export interface LedgerRow {
  id: string;
  title: string;
  storeName: string;
  amountText: string;
  /** 余额增加用成功色，减少用危险色。 */
  plus: boolean;
  balanceText: string;
  /** 「14:30」，按天分组的列表用。 */
  timeText: string;
  /** 「今天 14:30」「10月25日 周六 14:30」，不分组时用。 */
  whenText: string;
  dateTimeText: string;
  reversed: boolean;
  isReversal: boolean;
}

export function toRow(entry: LedgerItem, now: Date = new Date()): LedgerRow {
  return {
    id: entry.id,
    title: entryTitle(entry),
    storeName: entry.storeName,
    amountText: formatChange(entry.changeCent),
    plus: entry.changeCent > 0,
    balanceText: formatYuan(entry.balanceAfter),
    timeText: clock(entry.createdAt),
    whenText: `${dayLabel(entry.createdAt, now)} ${clock(entry.createdAt)}`,
    dateTimeText: dateTime(entry.createdAt),
    reversed: entry.reversed,
    isReversal: entry.type === 'REVERSAL',
  };
}

export interface LedgerGroup {
  key: string;
  label: string;
  rows: LedgerRow[];
}

/** 按北京时间的日期分组，保持接口给的先后顺序（新的在前）。 */
export function groupByDay(entries: LedgerItem[], now: Date = new Date()): LedgerGroup[] {
  const groups: LedgerGroup[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(entry.createdAt, now), rows: [] };
      groups.push(group);
    }
    group.rows.push(toRow(entry, now));
  }
  return groups;
}
