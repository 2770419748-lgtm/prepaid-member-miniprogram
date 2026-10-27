import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatCent, formatChange, MAX_AMOUNT_CENT, parseYuanToCent } from '../utils/money';

test('店员输入的元换成整数分，不经过浮点', () => {
  const cases: [string, number][] = [
    ['30', 3000],
    ['30.5', 3050],
    ['30.50', 3050],
    ['0.01', 1],
    ['0.1', 10],
    ['19.99', 1999],
    ['007.10', 710],
    ['12.', 1200],
    [' 88 ', 8800],
    ['1000000', MAX_AMOUNT_CENT],
  ];
  for (const [input, cent] of cases) {
    assert.deepEqual(parseYuanToCent(input), { ok: true, cent }, input);
  }
});

test('非法金额给出白话原因', () => {
  const cases: [string, string][] = [
    ['', '请输入金额'],
    ['   ', '请输入金额'],
    ['abc', '金额只能是数字'],
    ['-5', '金额只能是数字'],
    ['1e3', '金额只能是数字'],
    ['.5', '金额只能是数字'],
    ['1.234', '金额最多两位小数'],
    ['0', '金额要大于 0'],
    ['0.00', '金额要大于 0'],
    ['1000000.01', '单笔不能超过 100 万元'],
    ['12345678', '单笔不能超过 100 万元'],
    ['99999999999999999999', '单笔不能超过 100 万元'],
  ];
  for (const [input, reason] of cases) {
    assert.deepEqual(parseYuanToCent(input), { ok: false, reason }, input);
  }
});

test('金额统一两位小数，千分位分隔', () => {
  assert.equal(formatCent(0), '0.00');
  assert.equal(formatCent(5), '0.05');
  assert.equal(formatCent(7000), '70.00');
  assert.equal(formatCent(123456), '1,234.56');
  assert.equal(formatCent(MAX_AMOUNT_CENT), '1,000,000.00');
  assert.equal(formatCent(-3000), '-30.00');
});

test('余额变动带正负号', () => {
  assert.equal(formatChange(10000), '+100.00');
  assert.equal(formatChange(-3000), '-30.00');
});
