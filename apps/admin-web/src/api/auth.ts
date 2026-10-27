import { http } from './http';
import type { MyStoresResult, StaffLoginResult, StaffMeResult } from './types';

export async function loginWithPassword(phone: string, password: string): Promise<StaffLoginResult> {
  const { data } = await http.post<StaffLoginResult>('/auth/staff/password/login', { phone, password });
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await http.post('/auth/staff/password/change', { currentPassword, newPassword });
}

export async function fetchMe(): Promise<StaffMeResult> {
  const { data } = await http.get<StaffMeResult | { principalType: 'MEMBER' }>('/auth/me');
  if (data.principalType !== 'STAFF') {
    throw new Error('not staff');
  }
  return data;
}

export async function fetchMyStores(): Promise<MyStoresResult> {
  const { data } = await http.get<MyStoresResult>('/staff/me/stores');
  return data;
}
