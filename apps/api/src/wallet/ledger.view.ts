import { LedgerType, Prisma } from '@prisma/client';

export const ledgerInclude = {
  member: { select: { phone: true, name: true } },
  store: { select: { name: true } },
  operator: { select: { name: true } },
  reversedBy: { select: { id: true } },
  reversalOf: { select: { type: true } },
} satisfies Prisma.LedgerEntryInclude;

export type LedgerRecord = Prisma.LedgerEntryGetPayload<{ include: typeof ledgerInclude }>;

/** 店员看到的流水。 */
export interface StaffLedgerView {
  id: string;
  memberId: string;
  memberPhone: string;
  memberName: string | null;
  storeId: string;
  storeName: string;
  operatorStaffId: string | null;
  operatorName: string | null;
  type: LedgerType;
  /** 金额绝对值，单位分。 */
  amountCent: number;
  /** 这笔对余额的实际影响，单位分。加为正，减为负。 */
  changeCent: number;
  balanceBefore: number;
  balanceAfter: number;
  remark: string | null;
  /** 冲正流水指向的原流水。 */
  reversalOfId: string | null;
  /** 冲正流水抵掉的是哪一类（充值、消费或退款）。不是冲正为空。 */
  reversalOfType: LedgerType | null;
  /** 已被哪笔冲正。空表示没被冲正。 */
  reversedById: string | null;
  createdAt: string;
}

/** 会员看到的流水。不含操作店员和店内备注。 */
export interface MemberLedgerView {
  id: string;
  type: LedgerType;
  amountCent: number;
  changeCent: number;
  balanceAfter: number;
  storeName: string;
  reversalOfId: string | null;
  /** 撤销记录撤销的是哪一类（充值、消费或退款）。不是撤销记录为空。 */
  reversalOfType: LedgerType | null;
  reversed: boolean;
  createdAt: string;
}

export function toStaffLedgerView(entry: LedgerRecord): StaffLedgerView {
  return {
    id: entry.id,
    memberId: entry.memberId,
    memberPhone: entry.member.phone,
    memberName: entry.member.name,
    storeId: entry.storeId,
    storeName: entry.store.name,
    operatorStaffId: entry.operatorStaffId,
    operatorName: entry.operator?.name ?? null,
    type: entry.type,
    amountCent: entry.amountCent,
    changeCent: entry.balanceAfter - entry.balanceBefore,
    balanceBefore: entry.balanceBefore,
    balanceAfter: entry.balanceAfter,
    remark: entry.remark,
    reversalOfId: entry.reversalOfId,
    reversalOfType: entry.reversalOf?.type ?? null,
    reversedById: entry.reversedBy?.id ?? null,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toMemberLedgerView(entry: LedgerRecord): MemberLedgerView {
  return {
    id: entry.id,
    type: entry.type,
    amountCent: entry.amountCent,
    changeCent: entry.balanceAfter - entry.balanceBefore,
    balanceAfter: entry.balanceAfter,
    storeName: entry.store.name,
    reversalOfId: entry.reversalOfId,
    reversalOfType: entry.reversalOf?.type ?? null,
    reversed: entry.reversedBy != null,
    createdAt: entry.createdAt.toISOString(),
  };
}
