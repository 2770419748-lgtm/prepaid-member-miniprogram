import type { LedgerType, StaffRole } from './types';

export const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: '超级管理员',
  STORE_MANAGER: '店长',
  STAFF: '店员',
};

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REVERSAL: '冲正',
  REFUND: '退余额',
};

/** 冲正说清抵掉的是哪一类：按原流水类型；老数据没有类型时按方向（减余额抵的是充值，加余额抵的是消费）。 */
export function ledgerTitle(type: LedgerType, changeCent: number, reversalOfType?: LedgerType | null): string {
  if (type !== 'REVERSAL') {
    return LEDGER_TYPE_LABELS[type];
  }
  if (reversalOfType === 'REFUND') {
    return '冲正 · 抵掉退余额';
  }
  return changeCent < 0 ? '冲正 · 抵掉充值' : '冲正 · 抵掉消费';
}
