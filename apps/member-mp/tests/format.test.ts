import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock, dateTime, dayLabel, formatChange, formatYuan, maskPhone } from '../utils/format';

test('分转元：两位小数、千分位、不经过浮点', () => {
  assert.equal(formatYuan(0), '0.00');
  assert.equal(formatYuan(7), '0.07');
  assert.equal(formatYuan(7000), '70.00');
  assert.equal(formatYuan(123456789), '1,234,567.89');
  assert.equal(formatYuan(-3050), '-30.50');
  // 0.1 + 0.2 这类浮点误差不会出现
  assert.equal(formatYuan(10 + 20), '0.30');
});

test('带符号金额：加为 +，减为 -', () => {
  assert.equal(formatChange(10000), '+100.00');
  assert.equal(formatChange(-3000), '-30.00');
  assert.equal(formatChange(0), '0.00');
});

test('手机号中间四位打码', () => {
  assert.equal(maskPhone('13800138000'), '138****8000');
  assert.equal(maskPhone('0571-88886666'), '0571-88886666');
});

test('时间按北京时间显示', () => {
  // UTC 16:30 是北京时间第二天 00:30
  assert.equal(clock('2026-10-26T16:30:00.000Z'), '00:30');
  assert.equal(dateTime('2026-10-26T16:30:00.000Z'), '2026-10-27 00:30');
});

test('日期标签：今天、昨天、本年日期、往年日期', () => {
  const now = new Date('2026-10-27T04:00:00.000Z'); // 北京时间 10 月 27 日 12:00
  assert.equal(dayLabel('2026-10-26T16:30:00.000Z', now), '今天');
  assert.equal(dayLabel('2026-10-26T15:59:00.000Z', now), '昨天');
  assert.equal(dayLabel('2026-10-24T02:00:00.000Z', now), '10月24日 周六');
  assert.equal(dayLabel('2025-12-31T02:00:00.000Z', now), '2025年12月31日 周三');
});
