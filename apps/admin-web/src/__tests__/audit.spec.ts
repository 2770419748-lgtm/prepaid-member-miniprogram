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

  it('消费抵扣带上九讯云订单号和商品金额，手输的标出来', () => {
    expect(
      describeAuditPayload(
        { amountCent: 12990, balanceBefore: 78650, balanceAfter: 65660, orderNo: 'A5982', productAmountCent: 129900 },
        storeName,
      ),
    ).toEqual(['金额 129.90 元', '余额 786.50 → 656.60 元', '九讯云订单 A5982', '商品应付 1,299.00 元']);
    expect(describeAuditPayload({ orderNo: 'A6021', orderNoTyped: true }, storeName)).toEqual([
      '九讯云订单 A6021（手输单号）',
    ]);
  });

  it('无码抵扣写明没扫会员码和原因', () => {
    expect(
      describeAuditPayload(
        { amountCent: 12990, productAmountCent: 129900, codeless: true, remark: '顾客没带手机' },
        storeName,
      ),
    ).toEqual(['金额 129.90 元', '没扫会员码，没填九讯云单号', '商品应付 1,299.00 元', '无码原因 顾客没带手机']);
    expect(
      describeAuditPayload({ codeless: true, orderNo: 'A5982', orderNoTyped: true, remark: '手机没电' }, storeName),
    ).toEqual(['没扫会员码', '九讯云订单 A5982（手输单号）', '无码原因 手机没电']);
  });

  it('表格批量导入的门店写明来源和坐标', () => {
    expect(
      describeAuditPayload(
        { address: '成都市锦江区示例路 1 号', businessHours: '每天 10:00-22:00', lat: 30.65718, lng: 104.08081, source: 'import' },
        storeName,
      ),
    ).toEqual(['地址 成都市锦江区示例路 1 号', '营业时间 每天 10:00-22:00', '坐标 30.657180,104.080810', '用表格批量导入']);
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

  it('调店写成原来 → 现在，别家店用记录里的店名，移空了说明自动停用', () => {
    expect(
      describeAuditPayload(
        {
          previousRoles: [{ storeId: 's1', storeName: '旗舰店', role: 'STAFF' }],
          roles: [{ storeId: 's2', storeName: '内江店', role: 'STAFF' }],
        },
        storeName,
      ),
    ).toEqual(['门店角色 旗舰店 · 店员 → 内江店 · 店员']);
    expect(
      describeAuditPayload(
        { previousRoles: [{ storeId: 's1', storeName: '旗舰店', role: 'STAFF' }], roles: [], autoDisabled: true },
        storeName,
      ),
    ).toEqual(['门店角色 旗舰店 · 店员 → 无门店', '一家门店都不剩，账号已自动停用']);
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

  it('改会员资料写成「旧 → 新」，停用写原因', () => {
    expect(
      describeAuditPayload(
        { previousPhone: '139****0001', phone: '139****0002', previousName: '', name: '王姐', reason: '手机丢了' },
        storeName,
      ),
    ).toEqual(['称呼 未填 → 王姐', '手机号 139****0001 → 139****0002', '原因 手机丢了']);
    expect(describeAuditPayload({ status: 'DISABLED', reason: '手机丢失，先停用' }, storeName)).toEqual([
      '状态改为停用',
      '原因 手机丢失，先停用',
    ]);
  });

  it('退余额显示金额、前后余额和退款方式', () => {
    expect(
      describeAuditPayload({ amountCent: 2000, balanceBefore: 5000, balanceAfter: 3000, remark: '现金退回' }, storeName),
    ).toEqual(['金额 20.00 元', '余额 50.00 → 30.00 元', '备注 现金退回']);
  });

  it('没有内容时为空', () => {
    expect(describeAuditPayload(null, storeName)).toEqual([]);
    expect(describeAuditPayload({ status: 'DISABLED' }, storeName)).toEqual(['状态改为停用']);
  });
  it('审核体验入口写清开到什么时候', () => {
    const lines = describeAuditPayload(
      { until: '2026-11-11T05:00:00.000Z', extended: false, demoCreated: true },
      storeName,
    );
    expect(lines[0]).toMatch(/^开到 2026-11-11 \d{2}:00$/);
    expect(lines[1]).toBe('建好了演示公司和演示数据');
    expect(describeAuditPayload({ until: '2026-11-11T05:00:00.000Z', extended: true }, storeName)[0]).toMatch(/^延长到/);
  });
});
