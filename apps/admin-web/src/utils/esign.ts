import type { PlanStatus, SignFlowStatus, TemplateStatus } from '../api/esign';

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
  ARCHIVED: { label: '已归档', color: 'default' },
};

export const TEMPLATE_STATUS: Record<TemplateStatus, { label: string; color: string }> = PLAN_STATUS;

export const SIGN_STATUS_OPTIONS = (Object.keys(SIGN_STATUS) as SignFlowStatus[])
  .filter((s) => s !== 'DRAFT')
  .map((value) => ({ value, label: SIGN_STATUS[value].label }));
