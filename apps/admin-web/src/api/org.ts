import { http } from './http';
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
