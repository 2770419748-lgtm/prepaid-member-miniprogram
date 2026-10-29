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
