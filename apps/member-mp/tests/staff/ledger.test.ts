import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canCodelessAt, canRechargeAt, canReverse, groupByDay, pickStore, toLedgerRow } from '../../staff/utils/ledger';
import type { LedgerEntry, MyStore, MyStoresResult } from '../../staff/utils/types';

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'e1',
    memberId: 'm1',
    memberPhone: '13800138000',
    memberName: '王女士',
    storeId: 's1',
    storeName: '一号店',
    operatorStaffId: 'st1',
    operatorName: '小李',
    type: 'CONSUME',
    amountCent: 3000,
    changeCent: -3000,
    balanceBefore: 10000,
    balanceAfter: 7000,
    remark: null,
    reversalOfId: null,
    reversedById: null,
    createdAt: '2026-10-27T06:05:00Z',
    ...overrides,
  };
}

function store(id: string, role: MyStore['role'], status: MyStore['status'] = 'ACTIVE'): MyStore {
  return { id, name: id, status, address: null, phone: null, businessHours: null, role };
}

test('流水行：类型、打码手机号、带符号金额、颜色', () => {
  const row = toLedgerRow(entry({}));
  assert.equal(row.title, '消费');
  assert.equal(row.member, '138****8000 王女士');
  assert.equal(row.meta, '14:05 · 小李');
  assert.equal(row.change, '-30.00');
  assert.equal(row.tone, 'minus');
  assert.equal(row.balanceAfter, '70.00');

  const recharge = toLedgerRow(entry({ type: 'RECHARGE', changeCent: 10000, memberName: null }), { showStore: true });
  assert.equal(recharge.change, '+100.00');
  assert.equal(recharge.tone, 'plus');
  assert.equal(recharge.member, '138****8000');
  assert.equal(recharge.meta, '14:05 · 一号店 · 小李');
});

test('退余额和冲回退余额', () => {
  assert.equal(toLedgerRow(entry({ type: 'REFUND', changeCent: -5000 })).title, '退余额');
  assert.equal(
    toLedgerRow(entry({ type: 'REVERSAL', changeCent: 5000, reversalOfType: 'REFUND' })).title,
    '冲正 · 抵掉退余额',
  );
  assert.equal(toLedgerRow(entry({ type: 'REVERSAL', changeCent: 5000, reversalOfType: 'CONSUME' })).title, '冲正 · 抵掉消费');
});

test('冲正说清抵掉的是充值还是消费', () => {
  assert.equal(toLedgerRow(entry({ type: 'REVERSAL', changeCent: -10000 })).title, '冲正 · 抵掉充值');
  assert.equal(toLedgerRow(entry({ type: 'REVERSAL', changeCent: 3000 })).title, '冲正 · 抵掉消费');
});

test('按北京时间的日期分组，保持新的在前', () => {
  const now = new Date('2026-10-28T02:00:00Z');
  const days = groupByDay(
    [
      entry({ id: 'a', createdAt: '2026-10-28T01:00:00Z' }),
      entry({ id: 'b', createdAt: '2026-10-27T16:10:00Z' }),
      entry({ id: 'c', createdAt: '2026-10-27T15:50:00Z' }),
      entry({ id: 'd', createdAt: '2026-10-20T03:00:00Z' }),
    ],
    { now },
  );
  assert.deepEqual(
    days.map((day) => [day.label, day.rows.map((row) => row.id)]),
    [
      ['今天', ['a', 'b']],
      ['昨天', ['c']],
      ['10月20日', ['d']],
    ],
  );
});

test('冲正权限与服务端一致：超管或原门店店长，每笔只冲一次', () => {
  const superAdmin: MyStoresResult = { unrestricted: true, stores: [store('s1', 'SUPER_ADMIN')] };
  const manager: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STORE_MANAGER')] };
  const otherManager: MyStoresResult = { unrestricted: false, stores: [store('s2', 'STORE_MANAGER')] };
  const clerk: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STAFF')] };

  assert.equal(canReverse(entry({}), superAdmin), true);
  assert.equal(canReverse(entry({}), manager), true);
  assert.equal(canReverse(entry({}), otherManager), false);
  assert.equal(canReverse(entry({}), clerk), false);
  assert.equal(canReverse(entry({ reversedById: 'r1' }), superAdmin), false);
  assert.equal(canReverse(entry({ type: 'REVERSAL', reversalOfId: 'e0' }), superAdmin), false);
});

test('直接充值只给超级管理员和本店店长，店员走开单', () => {
  const superAdmin: MyStoresResult = { unrestricted: true, stores: [store('s1', 'SUPER_ADMIN')] };
  const manager: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STORE_MANAGER'), store('s2', 'STAFF')] };
  const clerk: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STAFF')] };

  assert.equal(canRechargeAt('s9', superAdmin), true);
  assert.equal(canRechargeAt('s1', manager), true);
  // 在别的店只是店员，在那家店也不能直接充值。
  assert.equal(canRechargeAt('s2', manager), false);
  assert.equal(canRechargeAt('s1', clerk), false);
});

test('无码抵扣：标题单列，只给超级管理员和这家门店的店长', () => {
  const row = toLedgerRow(entry({ codeless: true, remark: '顾客没带手机' }));
  assert.equal(row.title, '消费 · 无码抵扣');
  assert.equal(row.meta, '14:05 · 小李');
  // 冲正一笔无码抵扣，照旧叫「冲正 · 抵掉消费」。
  assert.equal(
    toLedgerRow(entry({ type: 'REVERSAL', changeCent: 3000, reversalOfType: 'CONSUME', codeless: false })).title,
    '冲正 · 抵掉消费',
  );
  const superAdmin: MyStoresResult = { unrestricted: true, stores: [] };
  const manager: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STORE_MANAGER'), store('s2', 'STAFF')] };
  const clerk: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STAFF')] };
  assert.equal(canCodelessAt('s9', superAdmin), true);
  assert.equal(canCodelessAt('s1', manager), true);
  assert.equal(canCodelessAt('s2', manager), false);
  assert.equal(canCodelessAt('s1', clerk), false);
});

test('当前门店：沿用上次选择，停用的店跳过', () => {
  const stores = [store('s1', 'STAFF', 'DISABLED'), store('s2', 'STAFF'), store('s3', 'STORE_MANAGER')];
  assert.equal(pickStore(stores, 's3')?.id, 's3');
  assert.equal(pickStore(stores, 's1')?.id, 's2');
  assert.equal(pickStore(stores, null)?.id, 's2');
  assert.equal(pickStore([store('s1', 'STAFF', 'DISABLED')], 's1'), null);
});
