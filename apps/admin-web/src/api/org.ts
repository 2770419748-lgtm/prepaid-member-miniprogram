import { http } from './http';
import type { StoreImportRow } from '../utils/store-import';
import type { ActiveStatus, PageQuery, PageResult, StaffRole, StaffView, StoreView } from './types';

export interface StoreForm {
  name?: string;
  address?: string;
  phone?: string;
  businessHours?: string;
  lat?: number | null;
  lng?: number | null;
  status?: ActiveStatus;
}

export async function listStores(query: PageQuery & { status?: ActiveStatus }): Promise<PageResult<StoreView>> {
  const { data } = await http.get<PageResult<StoreView>>('/stores', { params: query });
  return data;
}

export async function createStore(body: StoreForm & { name: string }): Promise<StoreView> {
  const { data } = await http.post<StoreView>('/stores', body);
  return data;
}

export async function updateStore(id: string, body: StoreForm): Promise<StoreView> {
  const { data } = await http.patch<StoreView>(`/stores/${encodeURIComponent(id)}`, body);
  return data;
}

/** 全部门店（不分页），下载门店表格用。 */
export async function listAllStores(): Promise<StoreView[]> {
  const all: StoreView[] = [];
  for (let page = 1; ; page += 1) {
    const result = await listStores({ page, pageSize: 100 });
    all.push(...result.items);
    if (result.items.length === 0 || all.length >= result.total) {
      return all;
    }
  }
}

export type StoreImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
export type StoreImportField = 'address' | 'phone' | 'businessHours' | 'location';

export interface StoreImportItem {
  /** 在提交的 rows 里的位置，从 0 开始。 */
  index: number;
  name: string;
  action: StoreImportAction;
  storeId: string | null;
  storeDisabled: boolean;
  changes: StoreImportField[];
  error: string | null;
}

export interface StoreImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  items: StoreImportItem[];
}

/** 用表格批量录门店。dryRun 只核对、列出会怎么处理；false 真正导入，有一行不对整批不导。 */
export async function importStores(body: { dryRun: boolean; rows: StoreImportRow[] }): Promise<StoreImportResult> {
  const { data } = await http.post<StoreImportResult>('/stores/import', body);
  return data;
}

export async function listStaff(query: PageQuery & { storeId?: string }): Promise<PageResult<StaffView>> {
  const { data } = await http.get<PageResult<StaffView>>('/staff', { params: query });
  return data;
}

export async function createStaff(body: {
  phone: string;
  name: string;
  storeId: string;
  role: StaffRole;
  password: string;
}): Promise<StaffView> {
  const { data } = await http.post<StaffView>('/staff', body);
  return data;
}

export async function updateStaff(
  id: string,
  body: { name?: string; status?: ActiveStatus; phone?: string },
): Promise<StaffView> {
  const { data } = await http.patch<StaffView>(`/staff/${encodeURIComponent(id)}`, body);
  return data;
}

export async function replaceStaffRoles(
  id: string,
  roles: { storeId: string; role: StaffRole }[],
): Promise<StaffView> {
  const { data } = await http.put<StaffView>(`/staff/${encodeURIComponent(id)}/roles`, { roles });
  return data;
}

export async function resetStaffPassword(id: string, password: string): Promise<StaffView> {
  const { data } = await http.post<StaffView>(`/staff/${encodeURIComponent(id)}/password/reset`, { password });
  return data;
}
