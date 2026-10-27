import { BadRequestException } from '@nestjs/common';
import { businessDate, businessDay } from '../src/common/business-day';

describe('businessDay (Asia/Shanghai)', () => {
  it('maps a date to Shanghai midnight-to-midnight', () => {
    const day = businessDay('2026-10-27');
    expect(day.from.toISOString()).toBe('2026-10-26T16:00:00.000Z');
    expect(day.to.toISOString()).toBe('2026-10-27T16:00:00.000Z');
  });

  it('puts 23:30 and 00:30 Shanghai time on different days', () => {
    expect(businessDate(new Date('2026-10-27T23:30:00+08:00'))).toBe('2026-10-27');
    expect(businessDate(new Date('2026-10-28T00:30:00+08:00'))).toBe('2026-10-28');
  });

  it('defaults to today in Shanghai, which is already tomorrow after 16:00 UTC', () => {
    expect(businessDay(undefined, new Date('2026-10-27T16:30:00Z')).date).toBe('2026-10-28');
  });

  it('rejects dates that do not exist or are malformed', () => {
    expect(() => businessDay('2026-02-30')).toThrow(BadRequestException);
    expect(() => businessDay('2026-1-5')).toThrow(BadRequestException);
    expect(businessDay('2028-02-29').date).toBe('2028-02-29');
  });
});
