import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LedgerItem } from '../utils/api';
import { entryTitle, groupByDay, toRow } from '../utils/ledger';

function entry(partial: Partial<LedgerItem>): LedgerItem {
  return {
    id: 'e1',
    type: 'RECHARGE',
    amountCent: 10000,
    changeCent: 10000,
    balanceAfter: 10000,
    storeName: '一号店',
    reversalOfId: null,
    reversed: false,
    createdAt: '2026-10-27T02:00:00.000Z',
    ...partial,
  };
}

test('名称用白话：冲正说成撤销，并区分撤销的是消费还是充值', () => {
  assert.equal(entryTitle({ type: 'RECHARGE', changeCent: 100 }), '充值');
  assert.equal(entryTitle({ type: 'CONSUME', changeCent: -100 }), '消费');
  assert.equal(entryTitle({ type: 'REVERSAL', changeCent: 100 }), '消费撤销');
  assert.equal(entryTitle({ type: 'REVERSAL', changeCent: -100 }), '充值撤销');
});

test('明细行：加减号、颜色、余额、已撤销标记', () => {
  const now = new Date('2026-10-27T04:00:00.000Z');
  const row = toRow(entry({ type: 'CONSUME', amountCent: 3000, changeCent: -3000, balanceAfter: 7000, reversed: true }), now);
  assert.equal(row.title, '消费');
  assert.equal(row.amountText, '-30.00');
  assert.equal(row.plus, false);
  assert.equal(row.balanceText, '70.00');
  assert.equal(row.reversed, true);
  assert.equal(row.timeText, '10:00');
  assert.equal(row.whenText, '今天 10:00');
});

test('按北京时间的日期分组，顺序不变', () => {
  const now = new Date('2026-10-27T04:00:00.000Z');
  const groups = groupByDay(
    [
      entry({ id: 'a', createdAt: '2026-10-27T01:00:00.000Z' }),
      entry({ id: 'b', createdAt: '2026-10-26T16:10:00.000Z' }), // 北京 27 日 00:10
      entry({ id: 'c', createdAt: '2026-10-26T15:50:00.000Z' }), // 北京 26 日 23:50
      entry({ id: 'd', createdAt: '2026-10-20T03:00:00.000Z' }),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((group) => [group.label, group.rows.map((row) => row.id)]),
    [
      ['今天', ['a', 'b']],
      ['昨天', ['c']],
      ['10月20日 周二', ['d']],
    ],
  );
});
