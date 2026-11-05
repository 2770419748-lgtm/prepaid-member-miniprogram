import { maxOffsetCent, normalizeOrderNo, ORDER_NO_INPUT_PATTERN, ORDER_NO_PATTERN } from '../src/wallet/order-no';

describe('order number', () => {
  it('reads the receipt barcode and the number typed from the receipt as the same order', () => {
    for (const raw of ['A5982', '5982', 'a5982', ' A 5982 ', '05982', 'A0005982']) {
      expect(normalizeOrderNo(raw)).toBe('A5982');
    }
  });

  it('rejects things that are not order numbers', () => {
    // 手机串号 15 位、商品 69 码 13 位、全 0、别的前缀、网址、空。
    for (const raw of ['860242083947116', '6942785121867', 'A0', '000', 'B5982', 'https://x.cn/A5982', '', 'A']) {
      expect(normalizeOrderNo(raw)).toBeNull();
    }
  });

  it('keeps the input check, the normalized form and the database check in line', () => {
    // 最多 10 位数字：手机串号、69 码都超过。
    expect(ORDER_NO_INPUT_PATTERN.test(' a01234567890 ')).toBe(false);
    expect(ORDER_NO_INPUT_PATTERN.test(' a0123456789 ')).toBe(true);
    expect(normalizeOrderNo('a0123456789')).toBe('A123456789');
    expect(ORDER_NO_PATTERN.test('A9999999999')).toBe(true);
    expect(ORDER_NO_PATTERN.test('A05982')).toBe(false);
  });

  it('caps the offset at 10% of the product amount, rounded down to the cent', () => {
    expect(maxOffsetCent(239_900)).toBe(23_990);
    expect(maxOffsetCent(239_909)).toBe(23_990);
    expect(maxOffsetCent(9)).toBe(0);
    expect(maxOffsetCent(100_000_000)).toBe(10_000_000);
  });
});
