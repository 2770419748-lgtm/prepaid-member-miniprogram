import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  defaultOffsetCent,
  maxOffsetCent,
  offsetCapReason,
  readScannedOrder,
  readTypedOrder,
} from '../../staff/utils/sale-order';

test('扫九讯云小票上的订单条码，读出 A+单号', () => {
  assert.deepEqual(readScannedOrder('A5982'), { ok: true, orderNo: 'A5982' });
  assert.deepEqual(readScannedOrder(' a05982\n'), { ok: true, orderNo: 'A5982' });
});

test('扫到手机盒上的串号、69 码或别的码，说清楚扫错了什么', () => {
  assert.deepEqual(readScannedOrder('860242083947116'), {
    ok: false,
    reason: '扫到的是手机串号，请扫九讯云小票上方的订单条码',
  });
  assert.deepEqual(readScannedOrder('6942785121867'), {
    ok: false,
    reason: '扫到的是商品条码，请扫九讯云小票上方的订单条码',
  });
  for (const raw of ['5982', 'B5982', 'A0', 'https://x.cn/A5982', '']) {
    const read = readScannedOrder(raw);
    assert.equal(read.ok, false, raw);
  }
});

test('条码扫不出来时手输单号：只输数字也行，和扫码认成同一张单', () => {
  for (const input of ['5982', 'A5982', ' a 5982 ', '005982']) {
    assert.deepEqual(readTypedOrder(input), { ok: true, orderNo: 'A5982' }, input);
  }
  assert.deepEqual(readTypedOrder(''), { ok: false, reason: '请输入小票上的单号' });
  for (const input of ['59.82', '五九八二', '0', '12345678901']) {
    assert.equal(readTypedOrder(input).ok, false, input);
  }
});

test('最多抵商品应付金额的 10%，向下取整到分；余额不够就抵余额', () => {
  assert.equal(maxOffsetCent(239_900), 23_990);
  assert.equal(maxOffsetCent(239_909), 23_990);
  assert.equal(maxOffsetCent(9), 0);
  assert.equal(defaultOffsetCent(239_900, 288_000), 23_990);
  assert.equal(defaultOffsetCent(239_900, 10_000), 10_000);
  assert.equal(defaultOffsetCent(239_900, 0), 0);
});

test('一张单最多抵 1000 元：10% 超过 1000 元也只抵 1000 元，并说清楚是哪条卡住的', () => {
  assert.equal(maxOffsetCent(999_999), 99_999);
  assert.equal(maxOffsetCent(1_000_000), 100_000);
  assert.equal(maxOffsetCent(1_599_900), 100_000);
  assert.equal(defaultOffsetCent(1_599_900, 500_000), 100_000);
  assert.equal(defaultOffsetCent(1_599_900, 65_660), 65_660);
  assert.equal(offsetCapReason(239_900), '商品金额的 10%');
  assert.equal(offsetCapReason(1_599_900), '一张单最多抵 1,000 元');
});
