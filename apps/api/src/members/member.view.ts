import { Prisma } from '@prisma/client';

export interface MemberView {
  id: string;
  orgId: string;
  phone: string;
  name: string | null;
  wxOpenId: string | null;
  wxUnionId: string | null;
  openStoreId: string | null;
  status: 'ACTIVE' | 'DISABLED';
  /** 还没在门店开卡。开卡由店员在门店办理。 */
  needsCard: boolean;
}

export function toMemberView(member: {
  id: string;
  orgId: string;
  phone: string;
  name: string | null;
  wxOpenId: string | null;
  wxUnionId: string | null;
  openStoreId: string | null;
  status: 'ACTIVE' | 'DISABLED';
}): MemberView {
  return {
    id: member.id,
    orgId: member.orgId,
    phone: member.phone,
    name: member.name,
    wxOpenId: member.wxOpenId,
    wxUnionId: member.wxUnionId,
    openStoreId: member.openStoreId,
    status: member.status,
    needsCard: member.openStoreId == null,
  };
}

export const memberCardInclude = {
  wallet: { select: { balanceCent: true, createdAt: true, updatedAt: true } },
  openStore: { select: { name: true } },
} satisfies Prisma.MemberInclude;

export type MemberCardRecord = Prisma.MemberGetPayload<{ include: typeof memberCardInclude }>;

/** 店员看到的会员卡。余额是全公司通用的总余额。 */
export interface MemberCardView {
  id: string;
  phone: string;
  name: string | null;
  status: 'ACTIVE' | 'DISABLED';
  hasCard: boolean;
  openStoreId: string | null;
  openStoreName: string | null;
  /** 单位分。没开卡时为空。 */
  balanceCent: number | null;
  openedAt: string | null;
  /** 会员是否已在小程序登录过。 */
  wechatBound: boolean;
  createdAt: string;
}

export function toMemberCardView(member: MemberCardRecord): MemberCardView {
  return {
    id: member.id,
    phone: member.phone,
    name: member.name,
    status: member.status,
    hasCard: member.wallet != null,
    openStoreId: member.openStoreId,
    openStoreName: member.openStore?.name ?? null,
    balanceCent: member.wallet?.balanceCent ?? null,
    openedAt: member.wallet?.createdAt.toISOString() ?? null,
    wechatBound: member.wxOpenId != null,
    createdAt: member.createdAt.toISOString(),
  };
}

/** 会员自己看到的余额。 */
export interface MemberWalletView {
  hasCard: boolean;
  balanceCent: number;
  openedAt: string | null;
  updatedAt: string | null;
}
