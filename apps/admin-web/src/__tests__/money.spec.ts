import { describe, expect, it } from 'vitest';
import { amountError, formatCent, formatChange, formatYuan, yuanToCent } from '../utils/money';

describe('yuanToCent', () => {
  it('按字符串换算，不走浮点', () => {
    expect(yuanToCent('100')).toBe(10000);
    expect(yuanToCent('0.01')).toBe(1);
    expect(yuanToCent('0.1')).toBe(10);
    expect(yuanToCent('19.99')).toBe(1999);
    expect(yuanToCent('1,000.5')).toBe(100050);
    expect(yuanToCent(' 88.50 ')).toBe(8850);
  });

  it('格式不对返回 null', () => {
    expect(yuanToCent('')).toBeNull();
    expect(yuanToCent('1.234')).toBeNull();
    expect(yuanToCent('-5')).toBeNull();
    expect(yuanToCent('abc')).toBeNull();
    expect(yuanToCent('1e3')).toBeNull();
    expect(yuanToCent('.5')).toBeNull();
  });
});

describe('amountError', () => {
  it('合法金额没有提示', () => {
    expect(amountError('100')).toBeNull();
    expect(amountError('1000000')).toBeNull();
  });

  it('空、零、超上限、格式错都有白话提示', () => {
    expect(amountError('')).toBe('请输入金额');
    expect(amountError('0')).toBe('金额至少 0.01 元');
    expect(amountError('1000000.01')).toBe('单笔不能超过 100 万元');
    expect(amountError('12.345')).toContain('最多两位小数');
  });
});

describe('formatCent', () => {
  it('两位小数、千分位', () => {
    expect(formatCent(0)).toBe('0.00');
    expect(formatCent(5)).toBe('0.05');
    expect(formatCent(123456789)).toBe('1,234,567.89');
    expect(formatCent(-3000)).toBe('-30.00');
  });

  it('带货币符号和加减号', () => {
    expect(formatYuan(10000)).toBe('¥100.00');
    expect(formatYuan(-10000)).toBe('-¥100.00');
    expect(formatChange(10000)).toBe('+100.00');
    expect(formatChange(-3000)).toBe('-30.00');
    expect(formatChange(0)).toBe('0.00');
  });
});
