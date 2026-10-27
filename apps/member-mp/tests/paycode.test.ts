import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LedgerItem, PayCodeState } from '../utils/api';
import { nextStep } from '../utils/paycode';

const entry: LedgerItem = {
  id: 'entry-1',
  type: 'CONSUME',
  amountCent: 3000,
  changeCent: -3000,
  balanceAfter: 7000,
  storeName: '旗舰店',
  reversalOfId: null,
  reversed: false,
  createdAt: '2026-10-27T10:20:00.000Z',
};

function state(status: PayCodeState['status'], extra: Partial<PayCodeState> = {}): PayCodeState {
  return { id: 'code-1', status, expiresAt: '2026-10-27T10:21:00.000Z', storeName: null, entry: null, ...extra };
}

test('还没扫：没到点接着等，到点换新码', () => {
  assert.deepEqual(nextStep(state('ACTIVE'), false), { kind: 'wait' });
  assert.deepEqual(nextStep(state('ACTIVE'), true), { kind: 'renew' });
});

test('门店扫过了：到点也不换码，等扣款结果', () => {
  assert.deepEqual(nextStep(state('SCANNED', { storeName: '旗舰店' }), true), { kind: 'scanned', storeName: '旗舰店' });
});

test('扣款成功：显示金额、门店、北京时间和剩余余额', () => {
  assert.deepEqual(nextStep(state('USED', { storeName: '旗舰店', entry }), false), {
    kind: 'used',
    used: { entryId: 'entry-1', amountText: '-30.00', balanceText: '70.00', storeName: '旗舰店', timeText: '2026-10-27 18:20' },
  });
});

test('过期了（没扫，或扫了没扣）：换新码', () => {
  assert.deepEqual(nextStep(state('EXPIRED'), false), { kind: 'renew' });
});

test('网络不好没问到：到点换码，否则接着等', () => {
  assert.deepEqual(nextStep(null, false), { kind: 'wait' });
  assert.deepEqual(nextStep(null, true), { kind: 'renew' });
});
