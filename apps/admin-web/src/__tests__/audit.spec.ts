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

  it('权益单的模板、状态变化翻成白话', () => {
    expect(
      describeAuditPayload(
        { name: '储值会员权益单', status: 'ACTIVE', esignTemplateId: 'tpl-1', benefitPlanId: 'p1' },
        storeName,
      ),
    ).toEqual(['名称 储值会员权益单', 'e签宝模板 tpl-1', '状态改为启用']);
    expect(describeAuditPayload({ title: '年度权益', status: 'ARCHIVED', itemCount: 3 }, storeName)).toEqual([
      '名称 年度权益',
      '3 条权益',
      '状态改为已下架',
    ]);
    expect(
      describeAuditPayload({ from: 'PENDING', to: 'SIGNED', env: 'SANDBOX', source: 'refresh' }, storeName),
    ).toEqual(['状态 待签署 → 已签署（刷新状态时同步）', '测试签署']);
  });

  it('没有内容时为空', () => {
    expect(describeAuditPayload(null, storeName)).toEqual([]);
    expect(describeAuditPayload({ status: 'DISABLED' }, storeName)).toEqual(['状态改为停用']);
  });
});
