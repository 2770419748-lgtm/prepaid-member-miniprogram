import { request } from './http';
import type {
  LedgerEntry,
  LedgerType,
  MemberCard,
  MoveResult,
  MyStoresResult,
  PageResult,
  StaffLoginResult,
} from './types';

/** 员工小程序用到的接口。说明见 docs/backend/m1-auth-stores.md 与 m2-ledger.md。 */

export function loginWithWechatPhone(input: { code: string; phoneCode: string; mockPhone?: string }) {
  return request<StaffLoginResult>('POST', '/auth/staff/wx-phone', { body: input, auth: false });
}

export function fetchMyStores(token?: string) {
  return request<MyStoresResult>('GET', '/staff/me/stores', { token });
}

/** 完整手机号精确查找。任何门店开的卡都能查到，因为余额全公司通用。 */
export async function findMemberByPhone(phone: string): Promise<MemberCard | null> {
  const page = await request<PageResult<MemberCard>>('GET', '/members', { query: { phone, pageSize: 1 } });
  return page.items[0] ?? null;
}

export function fetchMember(id: string) {
  return request<MemberCard>('GET', `/members/${encodeURIComponent(id)}`);
}

export function openCard(input: { phone: string; name?: string; storeId: string }) {
  return request<MemberCard>('POST', '/members/open', { body: input });
}

export interface MoneyMove {
  storeId: string;
  amountCent: number;
  remark?: string;
  requestId: string;
}

export function recordMove(memberId: string, kind: 'RECHARGE' | 'CONSUME', body: MoneyMove) {
  const action = kind === 'RECHARGE' ? 'recharge' : 'consume';
  return request<MoveResult>('POST', `/wallets/${encodeURIComponent(memberId)}/${action}`, { body });
}

export interface LedgerQuery {
  memberId?: string;
  storeId?: string;
  type?: LedgerType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function fetchLedger(query: LedgerQuery) {
  return request<PageResult<LedgerEntry>>('GET', '/ledger', { query: { ...query } });
}

export function fetchLedgerEntry(id: string) {
  return request<LedgerEntry>('GET', `/ledger/${encodeURIComponent(id)}`);
}

export function reverseEntry(id: string, body: { remark: string; requestId: string }) {
  return request<MoveResult>('POST', `/ledger/${encodeURIComponent(id)}/reversal`, { body });
}
