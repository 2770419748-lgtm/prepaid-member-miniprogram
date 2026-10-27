import type { StaffRole } from '../api/types';
import { formatCent } from './money';
import { maskPhone } from './phone';
import { ROLE_LABEL } from './roles';

type StoreName = (storeId: string) => string | null;

const STATUS_LABEL: Record<string, string> = { ACTIVE: '启用', DISABLED: '停用' };

function isRole(value: unknown): value is StaffRole {
  return value === 'SUPER_ADMIN' || value === 'STORE_MANAGER' || value === 'STAFF';
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * 把一条操作记录的内容翻成几句白话，列表里直接看得懂。
 * 只挑认识的字段；完整内容在详情里看。
 */
export function describeAuditPayload(payload: Record<string, unknown> | null, storeName: StoreName): string[] {
  if (!payload) {
    return [];
  }
  const lines: string[] = [];
  const p = payload;
  if (typeof p.amountCent === 'number') {
    lines.push(`金额 ${formatCent(p.amountCent)} 元`);
  }
  if (typeof p.balanceBefore === 'number' && typeof p.balanceAfter === 'number') {
    lines.push(`余额 ${formatCent(p.balanceBefore)} → ${formatCent(p.balanceAfter)} 元`);
  }
  if (typeof p.name === 'string' && p.name) {
    lines.push(`名称 ${p.name}`);
  }
  if (typeof p.phone === 'string' && p.phone) {
    lines.push(`电话 ${/^1\d{10}$/.test(p.phone) ? maskPhone(p.phone) : p.phone}`);
  }
  if (isRole(p.role)) {
    const store = typeof p.storeId === 'string' ? storeName(p.storeId) : null;
    lines.push(`${store ? `${store} · ` : ''}${ROLE_LABEL[p.role]}`);
  }
  if (Array.isArray(p.roles)) {
    const roles = p.roles
      .map((r: unknown) => {
        const item = r as { storeId?: unknown; role?: unknown };
        if (!isRole(item.role)) {
          return '';
        }
        const store = typeof item.storeId === 'string' ? storeName(item.storeId) : null;
        return `${store ?? '某门店'} · ${ROLE_LABEL[item.role]}`;
      })
      .filter(Boolean);
    lines.push(roles.length > 0 ? `角色改为 ${roles.join('、')}` : '移除了全部门店角色');
  }
  if (typeof p.status === 'string' && STATUS_LABEL[p.status]) {
    lines.push(`状态改为${STATUS_LABEL[p.status]}`);
  }
  if (typeof p.address === 'string') {
    lines.push(`地址 ${p.address}`);
  }
  if (typeof p.businessHours === 'string') {
    lines.push(`营业时间 ${p.businessHours}`);
  }
  if (typeof p.remark === 'string' && p.remark) {
    lines.push(`备注 ${p.remark}`);
  }
  if (p.mustChangePassword === true) {
    lines.push('下次登录需改密码');
  }
  const reason = text(p.reason);
  if (reason) {
    lines.push(`原因 ${reason}`);
  }
  return lines;
}
