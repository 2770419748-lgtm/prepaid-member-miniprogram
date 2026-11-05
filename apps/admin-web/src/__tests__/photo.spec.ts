import { describe, expect, it } from 'vitest';
import { fitSize } from '../utils/photo';

describe('协议单照片压缩尺寸', () => {
  it('长边超过 2000 像素等比缩小', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitSize(3024, 4032)).toEqual({ width: 1500, height: 2000 });
  });

  it('本来就小的不放大', () => {
    expect(fitSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });
});
