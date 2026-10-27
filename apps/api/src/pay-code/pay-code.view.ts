import { Prisma } from '@prisma/client';
import { ledgerInclude, MemberLedgerView, toMemberLedgerView } from '../wallet/ledger.view';
import { MemberCardView } from '../members/member.view';

/** 会员小程序拿到的新会员码。code 只在这里出现一次。 */
export interface IssuedPayCodeView {
  id: string;
  code: string;
  expiresAt: string;
  /** 隔多少秒换一张新码。 */
  refreshAfterSeconds: number;
}

/**
 * 会员看自己这张码现在怎样了。
 * ACTIVE 等着扫；SCANNED 门店已扫、正在填金额；USED 已扣款，entry 是那一笔；EXPIRED 过期了，换一张。
 */
export type MemberPayCodeStatus = 'ACTIVE' | 'SCANNED' | 'USED' | 'EXPIRED';

export interface MemberPayCodeStatusView {
  id: string;
  status: MemberPayCodeStatus;
  expiresAt: string;
  /** 在哪家门店扫的。扫之前为空。 */
  storeName: string | null;
  /** 用这张码扣的那一笔（会员视角，不含操作人和备注）。只有 USED 才有。 */
  entry: MemberLedgerView | null;
}

/** 店员扫码以后拿到的：这位会员是谁、余额多少、要在什么时候之前扣款。 */
export interface ScannedPayCodeView {
  member: MemberCardView;
  /** 过了这个时间就要请会员刷新会员码重新扫。 */
  expiresAt: string;
}

export const payCodeStatusInclude = {
  scannedStore: { select: { name: true } },
  ledgerEntry: { include: ledgerInclude },
} satisfies Prisma.MemberPayCodeInclude;

export type PayCodeStatusRecord = Prisma.MemberPayCodeGetPayload<{ include: typeof payCodeStatusInclude }>;

export function toMemberPayCodeStatusView(row: PayCodeStatusRecord, now: Date): MemberPayCodeStatusView {
  let status: MemberPayCodeStatus;
  if (row.status === 'USED') {
    status = 'USED';
  } else if (row.status === 'SCANNED') {
    status = row.claimExpiresAt && row.claimExpiresAt > now ? 'SCANNED' : 'EXPIRED';
  } else {
    status = row.expiresAt > now ? 'ACTIVE' : 'EXPIRED';
  }
  return {
    id: row.id,
    status,
    expiresAt: row.expiresAt.toISOString(),
    storeName: row.scannedStore?.name ?? null,
    entry: status === 'USED' && row.ledgerEntry ? toMemberLedgerView(row.ledgerEntry) : null,
  };
}
