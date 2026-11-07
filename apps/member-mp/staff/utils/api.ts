import { download, request, uploadFile } from './http';
import type {
  BenefitPlan,
  ContractTemplate,
  LedgerEntry,
  LedgerType,
  MemberAppCode,
  MemberCard,
  MoveResult,
  MyStoresResult,
  OrderCheck,
  OwnMemberSession,
  PageResult,
  ScannedPayCode,
  SignConfig,
  SignFlow,
  SignFlowStatus,
  StaffLoginResult,
  UploadedPhoto,
} from './types';

/**
 * 工作台用到的接口。说明见 docs/backend/m1-auth-stores.md、m2-ledger.md，
 * 开单：上传纸质协议单、上传即充值见 paper-agreement.md（2026-11-05 起默认）；电子签见 m4-esign-sandbox.md。
 * 登录在小程序的登录页（pages/login/login）统一做，在职员工的手机号直接得到员工登录。
 */

/** 员工登录续期，有效期从现在重新算。见 utils/keep-login.ts。 */
export function renewSession(token: string) {
  return request<StaffLoginResult>('POST', '/auth/staff/session/renew', { token });
}

/** 「切到我的会员卡」：用自己的手机号换一张会员登录（这个手机号还不是会员就建一个，没开卡）。 */
export function fetchOwnMemberSession() {
  return request<OwnMemberSession>('POST', '/auth/staff/member-session');
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
  /** 消费必须带上刚扫到的会员码。充值不用。 */
  payCode?: string;
  /** 消费必须带九讯云订单号和商品应付金额（分），最多抵商品金额的 10%。充值不用。无码抵扣单号选填。 */
  orderNo?: string;
  orderNoTyped?: boolean;
  productAmountCent?: number;
}

/** 记账页办理的三种：充值、扫码消费、无码抵扣（店长按手机号直接抵扣，不扫会员码）。 */
export type MoveKind = 'RECHARGE' | 'CONSUME' | 'CODELESS';

const MOVE_ACTION: Record<MoveKind, string> = {
  RECHARGE: 'recharge',
  CONSUME: 'consume',
  CODELESS: 'consume-codeless',
};

/** 扫到订单码后先查这张单抵过没有。真正拦住重复抵扣的是扣款时的服务端校验。 */
export function checkOrder(orderNo: string) {
  return request<OrderCheck>('GET', '/orders/check', { query: { orderNo } });
}

/** 店员扫顾客出示的会员码。之后 5 分钟内，这位店员在这家门店可以用这张码扣一次款。 */
export function scanPayCode(code: string, storeId: string) {
  return request<ScannedPayCode>('POST', '/pay-codes/scan', { body: { code, storeId } });
}

/** 无码抵扣时 remark 是必填的原因。 */
export function recordMove(memberId: string, kind: MoveKind, body: MoneyMove) {
  return request<MoveResult>('POST', `/wallets/${encodeURIComponent(memberId)}/${MOVE_ACTION[kind]}`, { body });
}

export interface LedgerQuery {
  memberId?: string;
  storeId?: string;
  type?: LedgerType;
  /** 'true' 只看无码抵扣。 */
  codeless?: 'true' | 'false';
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

/** 开单可选的权益单模板：只要启用的。 */
export async function fetchActiveTemplates(): Promise<ContractTemplate[]> {
  const page = await request<PageResult<ContractTemplate>>('GET', '/contract-templates', {
    query: { status: 'ACTIVE', pageSize: 50 },
  });
  return page.items;
}

export function fetchBenefitPlan(id: string) {
  return request<BenefitPlan>('GET', `/benefit-plans/${encodeURIComponent(id)}`);
}

export interface NewSignFlow {
  memberId: string;
  templateId: string;
  storeId: string;
  /** 会员权益金额（分），写进合同，顾客签完后充值到余额。 */
  rechargeAmountCent: number;
  requestId: string;
}

/** 生成合同、发给电子签平台。签完才充值，这一步不动余额。 */
export function createSignFlow(body: NewSignFlow) {
  return request<SignFlow>('POST', '/sign-flows', { body });
}

/** 到电子签平台核对一次签没签；签好了服务端顺手把金额充进余额。 */
export function refreshSignFlow(id: string) {
  return request<SignFlow>('POST', `/sign-flows/${encodeURIComponent(id)}/refresh`);
}

/** 重新取顾客的签署链接（画成二维码）。 */
export function renewSignUrl(id: string) {
  return request<SignFlow>('POST', `/sign-flows/${encodeURIComponent(id)}/sign-url`);
}

/** 撤销待签署的合同。只有超级管理员和发起门店的店长可以。 */
export function cancelSignFlow(id: string, reason: string) {
  return request<SignFlow>('POST', `/sign-flows/${encodeURIComponent(id)}/cancel`, { body: { reason } });
}

/** 在你的门店开的权益单（纸质协议单和电子签）。 */
export async function fetchSignFlows(query: {
  memberId?: string;
  templateId?: string;
  status?: SignFlowStatus;
  pageSize?: number;
}): Promise<SignFlow[]> {
  const page = await request<PageResult<SignFlow>>('GET', '/sign-flows', { query: { ...query } });
  return page.items;
}

/** 现在开单怎么签。只在开单页和首页文案用，取不到时按纸质协议单。 */
export function fetchSignConfig() {
  return request<SignConfig>('GET', '/sign-flows/config');
}

/** 开单可选的权益方案（纸质协议单直接挂方案）：只要启用的。 */
export async function fetchActivePlans(): Promise<BenefitPlan[]> {
  const page = await request<PageResult<BenefitPlan>>('GET', '/benefit-plans', {
    query: { status: 'ACTIVE', pageSize: 50 },
  });
  return page.items;
}

/** 传一张协议单照片（本机临时文件），返回照片 id。 */
export function uploadAgreementPhoto(filePath: string) {
  return uploadFile<UploadedPhoto>('/sign-flows/photos', filePath);
}

export interface NewPaperAgreement {
  memberId: string;
  storeId: string;
  benefitPlanId?: string;
  /** 会员权益金额（分），交单后立即充值到余额。 */
  rechargeAmountCent: number;
  photoIds: string[];
  requestId: string;
}

/** 交单：上传顾客签字的纸质协议单，同时充值会员权益金额。同一请求号重试只开一单、充一次。 */
export function createPaperAgreement(body: NewPaperAgreement) {
  return request<SignFlow>('POST', '/sign-flows/paper', { body });
}

/** 下载一张协议单照片到本机临时文件（要登录才能看，不能直接用网址）。 */
export function downloadAgreementPhoto(flowId: string, photoId: string) {
  return download(`/sign-flows/${encodeURIComponent(flowId)}/photos/${encodeURIComponent(photoId)}`);
}

export function fetchMemberAppCode() {
  return request<MemberAppCode>('GET', '/member-app/code');
}
