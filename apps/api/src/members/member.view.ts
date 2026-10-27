export interface MemberView {
  id: string;
  orgId: string;
  phone: string;
  wxOpenId: string | null;
  wxUnionId: string | null;
  openStoreId: string | null;
  status: 'ACTIVE' | 'DISABLED';
  /** 还没有开卡门店。开卡和余额不在本模块。 */
  needsCard: boolean;
}

export function toMemberView(member: {
  id: string;
  orgId: string;
  phone: string;
  wxOpenId: string | null;
  wxUnionId: string | null;
  openStoreId: string | null;
  status: 'ACTIVE' | 'DISABLED';
}): MemberView {
  return {
    id: member.id,
    orgId: member.orgId,
    phone: member.phone,
    wxOpenId: member.wxOpenId,
    wxUnionId: member.wxUnionId,
    openStoreId: member.openStoreId,
    status: member.status,
    needsCard: member.openStoreId == null,
  };
}
