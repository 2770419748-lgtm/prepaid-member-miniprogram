import { describe, expect, it } from 'vitest';
import { rechargeText } from '../utils/esign';

describe('开单带的会员权益金额', () => {
  it('签完才充值到账', () => {
    expect(rechargeText({ status: 'PENDING', rechargeEntryId: null })).toBe('签完后充值');
    expect(rechargeText({ status: 'SIGNED', rechargeEntryId: null })).toBe('签完正在充值');
    expect(rechargeText({ status: 'SIGNED', rechargeEntryId: 'entry-1' })).toBe('已充值到账');
    expect(rechargeText({ status: 'CANCELED', rechargeEntryId: null })).toBe('未签成，没有充值');
  });
});

describe('纸质协议单的会员权益金额', () => {
  it('上传后就充值，没充上提示刷新补上', () => {
    expect(rechargeText({ kind: 'PAPER', status: 'SIGNED', rechargeEntryId: 'entry-1' })).toBe('已充值到账');
    expect(rechargeText({ kind: 'PAPER', status: 'SIGNED', rechargeEntryId: null })).toContain('刷新状态');
  });

  it('充值后被冲正：说清楚钱已撤回', () => {
    expect(
      rechargeText({ kind: 'PAPER', status: 'SIGNED', rechargeEntryId: 'entry-1', rechargeReversed: true }),
    ).toBe('充值已冲正，金额已撤回');
  });
});
