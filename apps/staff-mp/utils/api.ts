import { request } from './http';
import type {
  BenefitPlan,
  ContractTemplate,
  LedgerEntry,
  LedgerType,
  MemberAppCode,
  MemberCard,
  MoveResult,
  MyStoresResult,
  PageResult,
  ScannedPayCode,
  SignFlow,
  SignFlowStatus,
  StaffLoginResult,
} from './types';

/**
 * 员工小程序用到的接口。说明见 docs/backend/m1-auth-stores.md、m2-ledger.md，
 * 开单（权益单签署、签完充值）见 m4-esign-sandbox.md。
 */

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
  /** 消费必须带上刚扫到的会员码。充值不用。 */
  payCode?: string;
}

/** 店员扫顾客出示的会员码。之后 5 分钟内，这位店员在这家门店可以用这张码扣一次款。 */
export function scanPayCode(code: string, storeId: string) {
  return request<ScannedPayCode>('POST', '/pay-codes/scan', { body: { code, storeId } });
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

/** 在你的门店发起的权益单。 */
export async function fetchSignFlows(query: {
  memberId?: string;
  templateId?: string;
  status?: SignFlowStatus;
  pageSize?: number;
}): Promise<SignFlow[]> {
  const page = await request<PageResult<SignFlow>>('GET', '/sign-flows', { query: { ...query } });
  return page.items;
}

export function fetchMemberAppCode() {
  return request<MemberAppCode>('GET', '/member-app/code');
}
