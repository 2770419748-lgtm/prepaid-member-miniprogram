import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canCancelFlow, orderUrl, signProgress, stepDots } from '../utils/order';
import type { MyStoresResult } from '../utils/types';

const store = (id: string, role: 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STAFF') => ({
  id,
  name: id,
  status: 'ACTIVE' as const,
  address: null,
  phone: null,
  businessHours: null,
  role,
});

test('步骤条：走过的打勾，当前的高亮', () => {
  assert.deepEqual(
    stepDots('sign').map((dot) => [dot.label, dot.state]),
    [
      ['手机号', 'done'],
      ['填权益', 'done'],
      ['签合同', 'current'],
      ['到账', 'todo'],
    ],
  );
});

test('签完合同才算到账：签了还没充上时显示正在充值', () => {
  assert.deepEqual(signProgress({ status: 'PENDING', rechargeAmountCent: 100000, rechargeEntryId: null }), {
    kind: 'waiting',
  });
  assert.deepEqual(signProgress({ status: 'SIGNED', rechargeAmountCent: 100000, rechargeEntryId: null }), {
    kind: 'recharging',
  });
  assert.deepEqual(signProgress({ status: 'SIGNED', rechargeAmountCent: 100000, rechargeEntryId: 'e1' }), {
    kind: 'done',
  });
  assert.deepEqual(signProgress({ status: 'SIGNED', rechargeAmountCent: null, rechargeEntryId: null }), {
    kind: 'done',
  });
});

test('拒签、过期、撤销都说清楚没有充值', () => {
  for (const status of ['REJECTED', 'EXPIRED', 'CANCELED'] as const) {
    const progress = signProgress({ status, rechargeAmountCent: 100000, rechargeEntryId: null });
    assert.equal(progress.kind, 'ended');
    assert.match(progress.kind === 'ended' ? progress.text : '', /没有充值/);
  }
});

test('撤销合同：超级管理员或发起门店的店长，店员不行，签完的不能撤', () => {
  const flow = { status: 'PENDING' as const, store: { id: 's1', name: '滨江店' } };
  const manager: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STORE_MANAGER')] };
  const otherManager: MyStoresResult = { unrestricted: false, stores: [store('s2', 'STORE_MANAGER')] };
  const clerk: MyStoresResult = { unrestricted: false, stores: [store('s1', 'STAFF')] };
  const admin: MyStoresResult = { unrestricted: true, stores: [] };
  assert.equal(canCancelFlow(flow, manager), true);
  assert.equal(canCancelFlow(flow, admin), true);
  assert.equal(canCancelFlow(flow, otherManager), false);
  assert.equal(canCancelFlow(flow, clerk), false);
  assert.equal(canCancelFlow({ ...flow, status: 'SIGNED' }, admin), false);
});

test('开单页地址：从头开始、老会员直接填权益、接着签', () => {
  assert.equal(orderUrl(), '/pages/order/order');
  assert.equal(orderUrl({ phone: '13800138000' }), '/pages/order/order?phone=13800138000');
  assert.equal(orderUrl({ memberId: 'm1' }), '/pages/order/order?memberId=m1');
  assert.equal(orderUrl({ flowId: 'f 1' }), '/pages/order/order?flowId=f%201');
});
