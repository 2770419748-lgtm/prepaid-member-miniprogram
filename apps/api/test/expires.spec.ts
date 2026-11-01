import { parseExpiresSeconds, MINIPROGRAM_DEFAULT_EXPIRES_SECONDS } from '../src/auth/expires';

describe('parseExpiresSeconds', () => {
  it('defaults to 12 hours', () => {
    expect(parseExpiresSeconds(undefined)).toBe(12 * 60 * 60);
    expect(parseExpiresSeconds('nope')).toBe(12 * 60 * 60);
    expect(parseExpiresSeconds('0h')).toBe(12 * 60 * 60);
  });

  it('reads seconds, minutes, hours and days', () => {
    expect(parseExpiresSeconds('90')).toBe(90);
    expect(parseExpiresSeconds('15m')).toBe(900);
    expect(parseExpiresSeconds('12h')).toBe(43200);
    expect(parseExpiresSeconds('2d')).toBe(172800);
  });

  it('uses the given fallback when the value is missing or unreadable', () => {
    expect(MINIPROGRAM_DEFAULT_EXPIRES_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(parseExpiresSeconds(undefined, MINIPROGRAM_DEFAULT_EXPIRES_SECONDS)).toBe(30 * 24 * 60 * 60);
    expect(parseExpiresSeconds('', MINIPROGRAM_DEFAULT_EXPIRES_SECONDS)).toBe(30 * 24 * 60 * 60);
    expect(parseExpiresSeconds('forever', MINIPROGRAM_DEFAULT_EXPIRES_SECONDS)).toBe(30 * 24 * 60 * 60);
    expect(parseExpiresSeconds('90d', MINIPROGRAM_DEFAULT_EXPIRES_SECONDS)).toBe(90 * 86400);
  });
});
