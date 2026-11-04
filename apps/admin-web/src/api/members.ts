import { http } from './http';
import type { MemberCard, PageQuery, PageResult } from './types';

export async function openCard(body: { phone: string; name?: string; storeId: string }): Promise<MemberCard> {
  const { data } = await http.post<MemberCard>('/members/open', body);
  return data;
}

/** `phone` 是完整手机号精确查（能查到任何门店开的卡）；`keyword` 模糊查，只查本店会员。 */
export async function listMembers(
  query: PageQuery & { phone?: string; keyword?: string },
): Promise<PageResult<MemberCard>> {
  const { data } = await http.get<PageResult<MemberCard>>('/members', { params: query });
  return data;
}

export async function getMember(id: string): Promise<MemberCard> {
  const { data } = await http.get<MemberCard>(`/members/${encodeURIComponent(id)}`);
  return data;
}

/** 超级管理员改会员手机号或称呼。换号要写原因，会员旧手机上的登录马上失效。 */
export async function updateMember(
  id: string,
  body: { phone?: string; name?: string; reason?: string },
): Promise<MemberCard> {
  const { data } = await http.patch<MemberCard>(`/members/${encodeURIComponent(id)}`, body);
  return data;
}

/** 超级管理员停用 / 恢复会员，都要写原因。 */
export async function setMemberStatus(
  id: string,
  action: 'disable' | 'enable',
  reason: string,
): Promise<MemberCard> {
  const { data } = await http.post<MemberCard>(`/members/${encodeURIComponent(id)}/${action}`, { reason });
  return data;
}

/** 按完整手机号找会员。没找到返回 null。 */
export async function findMemberByPhone(phone: string): Promise<MemberCard | null> {
  const page = await listMembers({ phone, pageSize: 1 });
  return page.items[0] ?? null;
}
