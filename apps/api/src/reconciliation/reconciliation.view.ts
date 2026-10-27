/** 一家门店（或合计）一天的账。金额单位分。 */
export interface DailyFigures {
  rechargeCount: number;
  rechargeCent: number;
  consumeCount: number;
  consumeCent: number;
  reversalCount: number;
  /** 冲回的充值（余额减少）。 */
  reversedRechargeCent: number;
  /** 退回的消费（余额增加）。 */
  reversedConsumeCent: number;
  /** 充值减去冲回的充值：当天实际应收的储值款。 */
  netRechargeCent: number;
  /** 消费减去退回的消费：当天实际用掉的储值。 */
  netConsumeCent: number;
  /** 当天会员余额合计的净变化。 */
  netChangeCent: number;
}

export interface StoreDailyFigures extends DailyFigures {
  storeId: string;
  storeName: string;
  storeStatus: 'ACTIVE' | 'DISABLED';
}

/** 全公司储值余额的日结：日初 + 当日净变化 = 日末。 */
export interface DailyBalance {
  openingCent: number;
  netChangeCent: number;
  closingCent: number;
}

export interface DailyReconciliationView {
  date: string;
  timezone: string;
  from: string;
  to: string;
  stores: StoreDailyFigures[];
  total: DailyFigures;
  /** 只有超级管理员、且不按门店筛选时给出；余额全公司通用，按门店拆没有意义。 */
  balance: DailyBalance | null;
}

export interface OverviewView {
  /** 统计范围：超级管理员为全公司，其他人为自己的门店。 */
  scope: 'ORG' | 'STORES';
  /** 已开卡会员数。门店范围按开卡门店算。 */
  cardCount: number;
  /** 全公司储值余额合计。只有超级管理员能看，其他人为空。 */
  totalBalanceCent: number | null;
  today: DailyFigures & { date: string };
}

/** 一只余额和流水对不上的钱包。 */
export interface WalletMismatch {
  memberId: string;
  /** 已打码。 */
  memberPhone: string;
  memberName: string | null;
  /** 钱包里记的余额。 */
  balanceCent: number;
  /** 按流水逐笔加减算出来的余额。 */
  ledgerNetCent: number;
  /** 钱包被改过几次。每记一笔加一，应等于流水笔数。 */
  version: number;
  entryCount: number;
  /** 最后一笔流水的后余额；没有流水为空。 */
  lastBalanceAfter: number | null;
  /** 前后余额接不上的次数。 */
  chainBreaks: number;
}

export interface IntegrityCheckView {
  checkedAt: string;
  /** 全部对得上为 true。 */
  ok: boolean;
  walletCount: number;
  entryCount: number;
  /** 所有钱包余额之和。 */
  totalBalanceCent: number;
  /** 所有流水逐笔加减之和。应等于 totalBalanceCent。 */
  ledgerNetCent: number;
  mismatchCount: number;
  /** 最多列出前 100 只。 */
  mismatches: WalletMismatch[];
}

export function emptyFigures(): DailyFigures {
  return {
    rechargeCount: 0,
    rechargeCent: 0,
    consumeCount: 0,
    consumeCent: 0,
    reversalCount: 0,
    reversedRechargeCent: 0,
    reversedConsumeCent: 0,
    netRechargeCent: 0,
    netConsumeCent: 0,
    netChangeCent: 0,
  };
}

/** 算出三个净额。原始计数和金额先累加好再调用。 */
export function settle(figures: DailyFigures): DailyFigures {
  const netRechargeCent = figures.rechargeCent - figures.reversedRechargeCent;
  const netConsumeCent = figures.consumeCent - figures.reversedConsumeCent;
  return { ...figures, netRechargeCent, netConsumeCent, netChangeCent: netRechargeCent - netConsumeCent };
}
