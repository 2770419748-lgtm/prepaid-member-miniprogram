import type { LedgerType } from '../api/types';

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REVERSAL: '冲正',
};

export const LEDGER_TYPE_OPTIONS = (Object.keys(LEDGER_TYPE_LABEL) as LedgerType[]).map((value) => ({
  value,
  label: LEDGER_TYPE_LABEL[value],
}));
