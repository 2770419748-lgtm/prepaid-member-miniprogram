import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dayKey, dayLabel, formatClock, formatDateTime, startOfDaysAgo } from '../utils/time';

test('按北京时间显示，不跟手机时区', () => {
  // UTC 16:30 已是北京时间次日 00:30。
  assert.equal(dayKey('2026-10-27T16:30:00Z'), '2026-10-28');
  assert.equal(formatClock('2026-10-27T16:30:00Z'), '00:30');
  assert.equal(formatDateTime('2026-10-27T06:05:09Z'), '2026-10-27 14:05:09');
});

test('今天、昨天和更早的日期', () => {
  const now = new Date('2026-10-28T02:00:00Z'); // 北京时间 10 月 28 日 10:00
  assert.equal(dayLabel('2026-10-28', now), '今天');
  assert.equal(dayLabel('2026-10-27', now), '昨天');
  assert.equal(dayLabel('2026-10-05', now), '10月5日');
  assert.equal(dayLabel('2025-12-31', now), '2025年12月31日');
});

test('查询起点是北京时间零点', () => {
  const now = new Date('2026-10-27T17:00:00Z'); // 北京时间 10 月 28 日 01:00
  assert.equal(startOfDaysAgo(1, now), '2026-10-27T16:00:00.000Z');
  assert.equal(startOfDaysAgo(7, now), '2026-10-21T16:00:00.000Z');
  const evening = new Date('2026-10-27T15:59:59Z'); // 北京时间 10 月 27 日 23:59:59
  assert.equal(startOfDaysAgo(1, evening), '2026-10-26T16:00:00.000Z');
});
