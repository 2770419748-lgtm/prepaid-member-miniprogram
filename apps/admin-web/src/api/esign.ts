import { http } from './http';
import type { PageQuery, PageResult } from './types';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SignFlowStatus = 'DRAFT' | 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';

export interface BenefitItem {
  title: string;
  detail?: string | null;
}

/** 权益方案：会员能享受什么。权益单（合同）里写的就是它。 */
export interface BenefitPlan {
  id: string;
  title: string;
  summary: string | null;
  items: BenefitItem[];
  rules: string | null;
  status: PlanStatus;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BenefitPlanForm {
  title: string;
  summary?: string;
  items: BenefitItem[];
  rules?: string;
  status?: PlanStatus;
}

/** 合同模板：e签宝里做好的权益单模板，绑到后台。 */
export interface ContractTemplate {
  id: string;
  name: string;
  esignTemplateId: string;
  status: TemplateStatus;
  benefitPlan: { id: string; title: string } | null;
  memberSignKeyword: string;
  sealKeyword: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractTemplateForm {
  name?: string;
  esignTemplateId?: string;
  benefitPlanId?: string | null;
  status?: TemplateStatus;
  memberSignKeyword?: string;
  sealKeyword?: string;
}

export interface SignFlow {
  id: string;
  title: string;
  status: SignFlowStatus;
  env: 'SANDBOX' | 'PRODUCTION';
  member: { id: string; phone: string; name: string | null };
  template: { id: string; name: string };
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 只有待签署时有。 */
  signUrl: string | null;
  hasPdf: boolean;
  signedAt: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listPlans(query: PageQuery & { status?: PlanStatus }): Promise<PageResult<BenefitPlan>> {
  const { data } = await http.get<PageResult<BenefitPlan>>('/benefit-plans', { params: query });
  return data;
}

export async function createPlan(body: BenefitPlanForm): Promise<BenefitPlan> {
  const { data } = await http.post<BenefitPlan>('/benefit-plans', body);
  return data;
}

export async function updatePlan(id: string, body: Partial<BenefitPlanForm>): Promise<BenefitPlan> {
  const { data } = await http.patch<BenefitPlan>(`/benefit-plans/${encodeURIComponent(id)}`, body);
  return data;
}

export async function listTemplates(
  query: PageQuery & { status?: TemplateStatus; benefitPlanId?: string },
): Promise<PageResult<ContractTemplate>> {
  const { data } = await http.get<PageResult<ContractTemplate>>('/contract-templates', { params: query });
  return data;
}

export async function createTemplate(body: ContractTemplateForm & { name: string; esignTemplateId: string }): Promise<ContractTemplate> {
  const { data } = await http.post<ContractTemplate>('/contract-templates', body, { timeout: 30000 });
  return data;
}

export async function updateTemplate(id: string, body: ContractTemplateForm): Promise<ContractTemplate> {
  const { data } = await http.patch<ContractTemplate>(`/contract-templates/${encodeURIComponent(id)}`, body);
  return data;
}

export interface SignFlowQuery extends PageQuery {
  status?: SignFlowStatus;
  memberId?: string;
  templateId?: string;
  storeId?: string;
}

export async function listSignFlows(query: SignFlowQuery): Promise<PageResult<SignFlow>> {
  const { data } = await http.get<PageResult<SignFlow>>('/sign-flows', { params: query });
  return data;
}

export async function createSignFlow(body: {
  memberId: string;
  templateId: string;
  storeId: string;
  requestId: string;
}): Promise<SignFlow> {
  const { data } = await http.post<SignFlow>('/sign-flows', body, { timeout: 30000 });
  return data;
}

export async function refreshSignFlow(id: string): Promise<SignFlow> {
  const { data } = await http.post<SignFlow>(`/sign-flows/${encodeURIComponent(id)}/refresh`, {}, { timeout: 30000 });
  return data;
}

export async function cancelSignFlow(id: string, reason: string): Promise<SignFlow> {
  const { data } = await http.post<SignFlow>(`/sign-flows/${encodeURIComponent(id)}/cancel`, { reason });
  return data;
}

/** 下载签好的权益单 PDF。带登录凭证，所以不能直接用链接打开。 */
export async function downloadSignedPdf(flow: SignFlow): Promise<void> {
  const { data } = await http.get<Blob>(`/sign-flows/${encodeURIComponent(flow.id)}/pdf`, {
    responseType: 'blob',
    timeout: 60000,
  });
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${flow.title || '权益单'}-${flow.member.name || flow.member.phone}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
