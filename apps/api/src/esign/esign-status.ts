import { SignFlowStatus } from '@prisma/client';

/**
 * e签宝 v3 流程状态（signFlowStatus）→ 本系统状态。
 *
 * | e签宝 | 含义 | 本系统 |
 * | --- | --- | --- |
 * | 0 | 草稿 | DRAFT |
 * | 1 | 签署中 | PENDING |
 * | 2 | 完成（会员已签、企业章已盖） | SIGNED |
 * | 3 | 撤销 | CANCELED |
 * | 5 | 过期 | EXPIRED |
 * | 7 | 拒签 | REJECTED |
 *
 * 其他值不认识，保持原状态，等下次核对。
 */
const ESIGN_STATUS: Record<number, SignFlowStatus> = {
  0: SignFlowStatus.DRAFT,
  1: SignFlowStatus.PENDING,
  2: SignFlowStatus.SIGNED,
  3: SignFlowStatus.CANCELED,
  5: SignFlowStatus.EXPIRED,
  7: SignFlowStatus.REJECTED,
};

export function mapEsignStatus(code: number): SignFlowStatus | null {
  return ESIGN_STATUS[code] ?? null;
}

export const FINAL_STATUSES: readonly SignFlowStatus[] = [
  SignFlowStatus.SIGNED,
  SignFlowStatus.REJECTED,
  SignFlowStatus.EXPIRED,
  SignFlowStatus.CANCELED,
];

export function isFinal(status: SignFlowStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/**
 * 已经结束的流程不再被改成别的状态；签署中可以往任何结束状态走。
 * e签宝侧状态本身也不会倒退，这里再兜一层。
 */
export function nextStatus(current: SignFlowStatus, remote: SignFlowStatus | null): SignFlowStatus {
  if (remote === null || isFinal(current)) {
    return current;
  }
  if (remote === SignFlowStatus.DRAFT) {
    return current;
  }
  return remote;
}
