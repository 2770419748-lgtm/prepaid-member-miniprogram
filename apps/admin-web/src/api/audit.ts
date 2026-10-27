import { http } from './http';
import type { PageQuery, PageResult } from './types';

export interface AuditLogItem {
  id: string;
  action: string;
  actionLabel: string;
  actorStaffId: string | null;
  actorName: string | null;
  storeId: string | null;
  storeName: string | null;
  targetType: string | null;
  targetId: string | null;
  /** 手机号已打码，不含密码和签署链接。 */
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditQuery extends PageQuery {
  action?: string;
  actorStaffId?: string;
  storeId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

export async function listAuditLogs(query: AuditQuery): Promise<PageResult<AuditLogItem>> {
  const { data } = await http.get<PageResult<AuditLogItem>>('/audit-logs', { params: query });
  return data;
}

export async function listAuditActions(): Promise<{ action: string; label: string }[]> {
  const { data } = await http.get<{ action: string; label: string }[]>('/audit-logs/actions');
  return data;
}
