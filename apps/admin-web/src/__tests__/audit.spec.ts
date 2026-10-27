import { describe, expect, it } from 'vitest';
import { describeAuditPayload } from '../utils/audit';

const names: Record<string, string> = { s1: '旗舰店' };
const storeName = (id: string) => names[id] ?? null;

describe('操作记录翻成白话', () => {
  it('记账类显示金额和前后余额', () => {
    expect(
      describeAuditPayload({ amountCent: 100000, balanceBefore: 0, balanceAfter: 100000, storeId: 's1' }, storeName),
    ).toEqual(['金额 1,000.00 元', '余额 0.00 → 1,000.00 元']);
  });

  it('员工角色显示门店名和中文角色', () => {
    expect(describeAuditPayload({ name: '李店员', phone: '13800000002', storeId: 's1', role: 'STAFF' }, storeName)).toEqual([
      '名称 李店员',
      '电话 138****0002',
      '旗舰店 · 店员',
    ]);
    expect(describeAuditPayload({ roles: [{ storeId: 's1', role: 'STORE_MANAGER' }] }, storeName)).toEqual([
      '角色改为 旗舰店 · 店长',
    ]);
    expect(describeAuditPayload({ roles: [] }, storeName)).toEqual(['移除了全部门店角色']);
  });

  it('没有内容时为空', () => {
    expect(describeAuditPayload(null, storeName)).toEqual([]);
    expect(describeAuditPayload({ status: 'DISABLED' }, storeName)).toEqual(['状态改为停用']);
  });
});
