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

// ---- 会员权益和权益单签署。字段和 docs/backend/m4-esign-sandbox.md 4.4 一致。

export type SignStatus = 'DRAFT' | 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';

export interface BenefitItem {
  title: string;
  detail: string | null;
}

export interface BenefitContent {
  summary: string | null;
  items: BenefitItem[];
  rules: string | null;
}

export interface MemberBenefit extends BenefitContent {
  id: string;
  title: string;
  /** 这个方案最能代表现状的一份权益单：已签 > 待签 > 最近一份。没发起过是 null。 */
  signFlow: { id: string; status: SignStatus; updatedAt: string } | null;
}

export interface SignFlowView {
  id: string;
  title: string;
  status: SignStatus;
  env: 'SANDBOX' | 'PRODUCTION';
  /** 测试环境签署，界面标「测试签署」。 */
  sandbox: boolean;
  benefitPlan: ({ id: string; title: string } & BenefitContent) | null;
  /** 会员权益金额（分），签署后充值到余额。没有金额的权益单为空。 */
  rechargeAmountCent: number | null;
  /** 这笔钱已经充进余额。 */
  recharged: boolean;
  hasPdf: boolean;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchBenefits(): Promise<MemberBenefit[]> {
  return request<MemberBenefit[]>('/members/me/benefits');
}

export function fetchSignFlows(query: { page: number; pageSize: number; status?: SignStatus }): Promise<PageResult<SignFlowView>> {
  return request<PageResult<SignFlowView>>('/members/me/sign-flows', { data: query });
}

export function fetchSignFlow(id: string): Promise<SignFlowView> {
  return request<SignFlowView>(`/members/me/sign-flows/${encodeURIComponent(id)}`);
}

/** 签署链接每次打开前现取，不缓存。 */
export function fetchSignUrl(id: string): Promise<{ signUrl: string; sandbox: boolean }> {
  return request<{ signUrl: string; sandbox: boolean }>(`/members/me/sign-flows/${encodeURIComponent(id)}/sign-url`, {
    method: 'POST',
  });
}

/** 从签署页回来时调，向电子签平台核对一次状态。 */
export function refreshSignFlow(id: string): Promise<SignFlowView> {
  return request<SignFlowView>(`/members/me/sign-flows/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
}

export function contractPdfPath(id: string): string {
  return `/members/me/sign-flows/${encodeURIComponent(id)}/pdf`;
}

/** 会员码：到店消费时出示，门店扫码后才能扣款。码只能用一次，隔一会儿就换新的。 */
export interface IssuedPayCode {
  id: string;
  /** 二维码里的那串数字。 */
  code: string;
  expiresAt: string;
  /** 隔多少秒换一张新码。 */
  refreshAfterSeconds: number;
}

/** ACTIVE 等着扫；SCANNED 门店已扫、正在填金额；USED 已扣款；EXPIRED 过期了要换新码。 */
export type PayCodeStatus = 'ACTIVE' | 'SCANNED' | 'USED' | 'EXPIRED';

export interface PayCodeState {
  id: string;
  status: PayCodeStatus;
  expiresAt: string;
  storeName: string | null;
  /** 用这张码扣的那一笔，只有 USED 时有。 */
  entry: LedgerItem | null;
}

export function issuePayCode(): Promise<IssuedPayCode> {
  return request<IssuedPayCode>('/members/me/pay-code', { method: 'POST' });
}

export function fetchPayCodeState(id: string): Promise<PayCodeState> {
  return request<PayCodeState>(`/members/me/pay-code/${encodeURIComponent(id)}`);
}
