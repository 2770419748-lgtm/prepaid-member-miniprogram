import { http } from './http';
import type { PageQuery, PageResult } from './types';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SignFlowStatus = 'DRAFT' | 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';
/** PAPER：门店拍照上传顾客签字的纸质协议单（坤总 2026-11-05 起默认）；ESIGN：电子签。 */
export type SignKind = 'ESIGN' | 'PAPER';
export type SignMode = SignKind;

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
  kind: SignKind;
  status: SignFlowStatus;
  env: 'SANDBOX' | 'PRODUCTION';
  /** 电子签沙箱，标「测试签署」。纸质协议单永远是 false。 */
  sandbox: boolean;
  member: { id: string; phone: string; name: string | null };
  /** 电子签用的模板。纸质协议单为空。 */
  template: { id: string; name: string } | null;
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 只有待签署时有。 */
  signUrl: string | null;
  /** 会员权益金额（分）。小程序工作台开单时填，会员签完后自动充值到余额。 */
  rechargeAmountCent: number | null;
  /** 签完（纸质协议单是上传后）自动记的那笔充值。 */
  rechargeEntryId: string | null;
  /** 那笔充值后来被冲正了，钱已撤回。 */
  rechargeReversed: boolean;
  hasPdf: boolean;
  /** 纸质协议单的照片，按上传先后。电子签为空。 */
  photos: { id: string; createdAt: string }[];
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

/** 现在开单怎么签，以及协议单照片的张数、大小上限。 */
export interface SignConfig {
  mode: SignMode;
  maxPhotos: number;
  maxPhotoBytes: number;
}

/** 取不到时按纸质协议单（坤总 2026-11-05 的决定），和服务端默认一致。 */
export const DEFAULT_SIGN_CONFIG: SignConfig = { mode: 'PAPER', maxPhotos: 9, maxPhotoBytes: 8 * 1024 * 1024 };

let cachedConfig: Promise<SignConfig> | null = null;

/** 开单方式一次登录内基本不变，几个页面共用一次请求；失败了下次再取。 */
export function getSignConfig(): Promise<SignConfig> {
  if (!cachedConfig) {
    cachedConfig = http
      .get<SignConfig>('/sign-flows/config')
      .then(({ data }) => data)
      .catch((error: unknown) => {
        cachedConfig = null;
        throw error;
      });
  }
  return cachedConfig;
}

export function loadSignConfig(): Promise<SignConfig> {
  return getSignConfig().catch(() => DEFAULT_SIGN_CONFIG);
}

/** 传一张协议单照片，返回照片 id，再用 addAgreementPhotos 挂到协议单上。 */
export async function uploadAgreementPhoto(photo: Blob, fileName: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', photo, fileName);
  const { data } = await http.post<{ id: string }>('/sign-flows/photos', form, { timeout: 60000 });
  return data;
}

export async function addAgreementPhotos(id: string, photoIds: string[]): Promise<SignFlow> {
  const { data } = await http.post<SignFlow>(`/sign-flows/${encodeURIComponent(id)}/photos`, { photoIds });
  return data;
}

export async function removeAgreementPhoto(id: string, photoId: string, reason: string): Promise<SignFlow> {
  const { data } = await http.post<SignFlow>(
    `/sign-flows/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}/remove`,
    { reason },
  );
  return data;
}

/** 协议单照片要带登录凭证才能看，取回来是 Blob，页面上用 URL.createObjectURL 显示。 */
export async function fetchAgreementPhoto(id: string, photoId: string): Promise<Blob> {
  const { data } = await http.get<Blob>(
    `/sign-flows/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
    { responseType: 'blob', timeout: 60000 },
  );
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
  // 老版本 Firefox 要求链接在页面里才会触发下载。
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
