import { request } from './request';

/** 金额一律是整数分。字段和 docs/backend/m2-ledger.md 的会员视角一致，只有会员自己能看的内容。 */

export interface MemberProfile {
  id: string;
  phone: string;
  name: string | null;
  status: 'ACTIVE' | 'DISABLED';
  needsCard: boolean;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  member: MemberProfile;
}

export interface WalletView {
  hasCard: boolean;
  balanceCent: number;
  openedAt: string | null;
  updatedAt: string | null;
}

export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL';

export interface LedgerItem {
  id: string;
  type: LedgerType;
  amountCent: number;
  /** 对余额的影响，加为正、减为负。 */
  changeCent: number;
  balanceAfter: number;
  storeName: string;
  /** 撤销记录指向被撤销的那一笔。 */
  reversalOfId: string | null;
  /** 这一笔已经被撤销。 */
  reversed: boolean;
  createdAt: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StoreView {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  businessHours: string | null;
}

export interface PhoneLogin {
  code: string;
  phoneCode: string;
  mockPhone?: string;
}

export function loginWithPhone(body: PhoneLogin): Promise<LoginResult> {
  return request<LoginResult>('/auth/member/wx-phone', {
    method: 'POST',
    data: { code: body.code, phoneCode: body.phoneCode, mockPhone: body.mockPhone },
    auth: false,
  });
}

export function fetchMe(): Promise<MemberProfile> {
  return request<MemberProfile>('/members/me');
}

export function fetchWallet(): Promise<WalletView> {
  return request<WalletView>('/members/me/wallet');
}

export function fetchLedger(query: { page: number; pageSize: number; type?: LedgerType }): Promise<PageResult<LedgerItem>> {
  return request<PageResult<LedgerItem>>('/ledger', { data: query });
}

export function fetchLedgerEntry(id: string): Promise<LedgerItem> {
  return request<LedgerItem>(`/ledger/${encodeURIComponent(id)}`);
}

export function fetchStores(): Promise<StoreView[]> {
  return request<StoreView[]>('/members/stores');
}
