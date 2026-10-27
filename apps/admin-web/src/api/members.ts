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

/** 按完整手机号找会员。没找到返回 null。 */
export async function findMemberByPhone(phone: string): Promise<MemberCard | null> {
  const page = await listMembers({ phone, pageSize: 1 });
  return page.items[0] ?? null;
}
