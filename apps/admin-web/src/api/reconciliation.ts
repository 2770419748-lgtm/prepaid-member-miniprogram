import { http } from './http';

/** 一段时间内的记账汇总，单位分。 */
export interface DayFigures {
  rechargeCount: number;
  rechargeCent: number;
  consumeCount: number;
  consumeCent: number;
  reversalCount: number;
  reversedRechargeCent: number;
  reversedConsumeCent: number;
  /** 扣掉冲正后的净充值。 */
  netRechargeCent: number;
  /** 扣掉冲正后的净消费。 */
  netConsumeCent: number;
  netChangeCent: number;
}

export interface Overview {
  scope: 'ORG' | 'STORES';
  cardCount: number;
  /** 只有超级管理员能看到全公司储值余额；店长、店员为空（余额全公司通用，按店切出来会误导）。 */
  totalBalanceCent: number | null;
  today: DayFigures & { date: string };
}

export async function fetchOverview(): Promise<Overview> {
  const { data } = await http.get<Overview>('/reconciliation/overview');
  return data;
}

export interface StoreDayFigures extends DayFigures {
  storeId: string;
  storeName: string;
  storeStatus: 'ACTIVE' | 'DISABLED';
}

export interface DailyReport {
  date: string;
  timezone: string;
  from: string;
  to: string;
  stores: StoreDayFigures[];
  total: DayFigures;
  /** 只有超级管理员、且不按门店筛选时给出。 */
  balance: { openingCent: number; netChangeCent: number; closingCent: number } | null;
}

export async function fetchDaily(query: { date?: string; storeId?: string }): Promise<DailyReport> {
  const { data } = await http.get<DailyReport>('/reconciliation/daily', { params: query });
  return data;
}

export interface CheckMismatch {
  memberId: string;
  memberPhone: string;
  memberName: string | null;
  balanceCent: number;
  ledgerNetCent: number;
  version: number;
  entryCount: number;
  lastBalanceAfter: number | null;
  chainBreaks: number;
}

export interface CheckResult {
  checkedAt: string;
  ok: boolean;
  walletCount: number;
  entryCount: number;
  totalBalanceCent: number;
  ledgerNetCent: number;
  mismatchCount: number;
  mismatches: CheckMismatch[];
}

/** 余额核对：逐张卡比对余额和流水。仅超级管理员。 */
export async function runCheck(): Promise<CheckResult> {
  const { data } = await http.get<CheckResult>('/reconciliation/check', { timeout: 60000 });
  return data;
}
