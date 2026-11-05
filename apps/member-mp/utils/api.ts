import type { StaffLoginResult } from '../staff/utils/types';
import { ApiError, request } from './request';

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
  principalType: 'MEMBER';
  member: MemberProfile;
}

/** 小程序登录的结果：在职员工拿到员工登录（进工作台），其他人拿到会员登录。 */
export type SignInResult = LoginResult | StaffLoginResult;

export interface WalletView {
  hasCard: boolean;
  balanceCent: number;
  openedAt: string | null;
  updatedAt: string | null;
}

/** REFUND 是退款：门店把没用完的储值退给会员。 */
export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL' | 'REFUND';

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
  /** 撤销记录撤销的是哪一类。不是撤销记录为空。 */
  reversalOfType?: LedgerType | null;
  /** 这一笔已经被撤销。 */
  reversed: boolean;
  /** 门店消费抵扣的订单号（如 A5982）；撤销记录显示被撤销那笔的订单号。以前的消费没有。 */
  orderNo?: string | null;
  /** 那张订单的商品金额，分。 */
  productAmountCent?: number | null;
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

/**
 * 微信手机号一键登录。会员和员工共用这一个小程序：服务端认出这个手机号是本公司在职员工，就返回员工登录，
 * 小程序直接进工作台；否则按会员登录（第一次登录就建好会员）。
 */
export function loginWithPhone(body: PhoneLogin): Promise<SignInResult> {
  return request<SignInResult>('/auth/wx-phone', {
    method: 'POST',
    data: { code: body.code, phoneCode: body.phoneCode, mockPhone: body.mockPhone },
    auth: false,
  });
}

/** 会员「我的」页用：workbench 为真表示这个手机号已经开通了工作台（重新登录一次就进）。 */
export function fetchAccount(): Promise<{ principalType: 'MEMBER'; workbench?: boolean }> {
  return request<{ principalType: 'MEMBER'; workbench?: boolean }>('/auth/me');
}

/**
 * 给微信审核员体验工作台的入口：超级管理员在商家后台打开「审核体验」后才有，平时登录页不显示。
 * 服务端还没有这个接口、或者没打开，都当作没有。
 */
export async function fetchReviewDemo(): Promise<boolean> {
  try {
    const result = await request<{ enabled?: boolean }>('/auth/review-demo', { auth: false });
    return result.enabled === true;
  } catch (error) {
    if (error instanceof ApiError) {
      return false;
    }
    throw error;
  }
}

/** 审核体验账号登录，拿到的是工作台（演示公司的假门店、假会员），和真实数据完全隔开。 */
export function loginReviewDemo(body: { account: string; password: string }): Promise<StaffLoginResult> {
  return request<StaffLoginResult>('/auth/review-demo/login', {
    method: 'POST',
    data: { account: body.account, password: body.password },
    auth: false,
  });
}

/** 续期登录，有效期从现在重新算。见 utils/keep-login.ts。 */
export function renewLogin(): Promise<LoginResult> {
  return request<LoginResult>('/auth/member/session/renew', { method: 'POST' });
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

// ---- 会员权益和权益单。字段和 docs/backend/m4-esign-sandbox.md 4.4、paper-agreement.md 一致。
// 2026-11-05 起开单改为门店上传顾客签字的纸质协议单（kind=PAPER，照片在 photos 里），电子签（ESIGN）的老单照常显示。

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
  /** PAPER：在门店签的纸质协议单，门店拍照上传；ESIGN：电子签。 */
  kind: 'ESIGN' | 'PAPER';
  status: SignStatus;
  env: 'SANDBOX' | 'PRODUCTION';
  /** 测试环境签署，界面标「测试签署」。纸质协议单永远是 false。 */
  sandbox: boolean;
  benefitPlan: ({ id: string; title: string } & BenefitContent) | null;
  /** 会员权益金额（分），签署后充值到余额。没有金额的权益单为空。 */
  rechargeAmountCent: number | null;
  /** 这笔钱已经充进余额。 */
  recharged: boolean;
  /** 充进去的钱后来被门店撤回了。 */
  rechargeReversed: boolean;
  hasPdf: boolean;
  /** 纸质协议单的照片。 */
  photos: { id: string; createdAt: string }[];
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

/** 协议单照片要登录才能看，用 download 取到本机再显示。 */
export function agreementPhotoPath(id: string, photoId: string): string {
  return `/members/me/sign-flows/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`;
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
