import { formatYuan, yuanInWords } from '../src/common/money-words';

describe('contract amount wording', () => {
  it('writes yuan with thousands separators', () => {
    expect(formatYuan(100000)).toBe('1,000.00');
    expect(formatYuan(100000000)).toBe('1,000,000.00');
    expect(formatYuan(5)).toBe('0.05');
    expect(formatYuan(123456789)).toBe('1,234,567.89');
  });

  it.each([
    [100000, '壹仟元整'],
    [100000000, '壹佰万元整'],
    [10000000, '壹拾万元整'],
    [1000500, '壹万零伍元整'],
    [1010000, '壹万零壹佰元整'],
    [1100000, '壹万壹仟元整'],
    [10010000, '壹拾万零壹佰元整'],
    [100000100, '壹佰万零壹元整'],
    [1234567, '壹万贰仟叁佰肆拾伍元陆角柒分'],
    [105, '壹元零伍分'],
    [150, '壹元伍角'],
    [5, '伍分'],
    [50, '伍角'],
    [0, '零元整'],
    [20000, '贰佰元整'],
    [300500, '叁仟零伍元整'],
    [10000000000, '壹亿元整'],
  ])('%i 分写成 %s', (cent, words) => {
    expect(yuanInWords(cent)).toBe(words);
  });

  it('rejects fractions of a cent and negatives', () => {
    expect(() => yuanInWords(1.5)).toThrow(RangeError);
    expect(() => yuanInWords(-1)).toThrow(RangeError);
  });
});
