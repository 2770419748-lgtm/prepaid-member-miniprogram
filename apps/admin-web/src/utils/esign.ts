import type { PlanStatus, SignFlowStatus, SignKind, TemplateStatus } from '../api/esign';

export const SIGN_STATUS: Record<SignFlowStatus, { label: string; color: string }> = {
  DRAFT: { label: '发起中', color: 'default' },
  PENDING: { label: '待签署', color: 'processing' },
  SIGNED: { label: '已签署', color: 'success' },
  REJECTED: { label: '已拒签', color: 'error' },
  EXPIRED: { label: '已过期', color: 'default' },
  CANCELED: { label: '已撤销', color: 'default' },
};

export const PLAN_STATUS: Record<PlanStatus, { label: string; color: string }> = {
  DRAFT: { label: '草稿', color: 'default' },
  ACTIVE: { label: '启用', color: 'success' },
  ARCHIVED: { label: '已下架', color: 'default' },
};

export const TEMPLATE_STATUS: Record<TemplateStatus, { label: string; color: string }> = {
  DRAFT: { label: '已停用', color: 'default' },
  ACTIVE: { label: '启用', color: 'success' },
  ARCHIVED: { label: '已下架', color: 'default' },
};

export const SIGN_STATUS_OPTIONS = (Object.keys(SIGN_STATUS) as SignFlowStatus[])
  .filter((s) => s !== 'DRAFT')
  .map((value) => ({ value, label: SIGN_STATUS[value].label }));

/** 开单带的会员权益金额：电子签签完才充值；纸质协议单上传后就充值。充值后被冲正的说清楚钱已撤回。 */
export function rechargeText(flow: {
  status: SignFlowStatus;
  rechargeEntryId: string | null;
  kind?: SignKind;
  rechargeReversed?: boolean;
}): string {
  if (flow.rechargeReversed) {
    return '充值已冲正，金额已撤回';
  }
  if (flow.status === 'SIGNED') {
    if (flow.rechargeEntryId) {
      return '已充值到账';
    }
    return flow.kind === 'PAPER' ? '正在充值，点「刷新状态」补上' : '签完正在充值';
  }
  return flow.status === 'PENDING' || flow.status === 'DRAFT' ? '签完后充值' : '未签成，没有充值';
}
