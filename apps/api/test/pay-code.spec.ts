import { generatePayCode, hashPayCode, normalizePayCode, PAY_CODE_LENGTH } from '../src/pay-code/pay-code';

describe('pay code format', () => {
  it('makes 18-digit codes starting with 8 that pass their own check digit', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const code = generatePayCode();
      expect(code).toMatch(/^8\d{17}$/);
      expect(code).toHaveLength(PAY_CODE_LENGTH);
      expect(normalizePayCode(code)).toBe(code);
      seen.add(code);
    }
    expect(seen.size).toBe(500);
  });

  it('catches a mistyped digit or two swapped neighbours', () => {
    const code = generatePayCode();
    const wrongDigit = code.slice(0, 5) + String((Number(code[5]) + 1) % 10) + code.slice(6);
    expect(normalizePayCode(wrongDigit)).toBeNull();
    const i = [...code].findIndex((digit, index) => index > 0 && index < 16 && digit !== code[index + 1]);
    const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
    // 0 和 9 互换是 Luhn 唯一查不出的相邻交换。
    if (!['09', '90'].includes(code[i] + code[i + 1])) {
      expect(normalizePayCode(swapped)).toBeNull();
    }
  });

  it('ignores spaces but rejects anything that is not a member code', () => {
    const code = generatePayCode();
    expect(normalizePayCode(` ${code.slice(0, 6)} ${code.slice(6)}\n`)).toBe(code);
    for (const other of ['', 'https://example.com', '134567890123456789', `9${code.slice(1)}`, `${code}0`, code.slice(1)]) {
      expect(normalizePayCode(other)).toBeNull();
    }
  });

  it('stores only a one-way hash', () => {
    const code = generatePayCode();
    expect(hashPayCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPayCode(code)).not.toContain(code);
  });
});
