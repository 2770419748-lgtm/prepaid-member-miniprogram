import { BadRequestException } from '@nestjs/common';
import { assertMainlandMobile, normalizePhone } from '../src/auth/phone';

describe('phone', () => {
  it('keeps an 11-digit mainland number', () => {
    expect(normalizePhone('13800138000')).toBe('13800138000');
  });

  it('strips country code and separators', () => {
    expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000');
    expect(normalizePhone('8613800138000')).toBe('13800138000');
  });

  it('rejects numbers that are not mainland mobiles', () => {
    expect(() => assertMainlandMobile(normalizePhone('12345'))).toThrow(BadRequestException);
    expect(() => assertMainlandMobile('23800138000')).toThrow('手机号格式不正确');
  });
});
