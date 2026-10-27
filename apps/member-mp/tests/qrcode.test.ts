import assert from 'node:assert/strict';
import { test } from 'node:test';
import jsQR from 'jsqr';
import { drawQr, encodeDigits } from '../utils/qrcode';

/** 把方格画到一块假的 RGBA 画布上，再用独立的解码库读出来。 */
function render(modules: boolean[][], cellPx = 4, quiet = 4): { data: Uint8ClampedArray; size: number } {
  const size = (modules.length + quiet * 2) * cellPx;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < cellPx; dy += 1) {
        for (let dx = 0; dx < cellPx; dx += 1) {
          const at = (((y + quiet) * cellPx + dy) * size + (x + quiet) * cellPx + dx) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    });
  });
  return { data, size };
}

function decode(digits: string): string | undefined {
  const { data, size } = render(encodeDigits(digits));
  return jsQR(data, size, size)?.data;
}

test('会员码编出来的二维码能被别的解码器读回原样', () => {
  for (const code of ['868123456789012345', '800000000000000000', '899999999999999999']) {
    assert.equal(decode(code), code);
  }
  for (let i = 0; i < 50; i += 1) {
    const code = `8${String(Math.random()).slice(2, 12).padEnd(10, '7')}${String(Math.random()).slice(2, 9).padEnd(7, '3')}`;
    assert.equal(decode(code), code);
  }
});

test('18 位会员码用最小的版本 1（21×21 格），格子大好扫', () => {
  assert.equal(encodeDigits('868123456789012345').length, 21);
});

test('更长的数字也能编码和读回', () => {
  for (const length of [1, 2, 3, 41, 60, 120, 200]) {
    const digits = '7'.repeat(length).replace(/7/g, (_, i: number) => String(i % 10));
    assert.equal(decode(digits), digits);
  }
});

test('只接受数字', () => {
  assert.throws(() => encodeDigits('abc'));
  assert.throws(() => encodeDigits(''));
});

test('画到画布上：先铺白底，黑格按整数像素对齐', () => {
  const rects: [number, number, number, number, unknown][] = [];
  const ctx = {
    fillStyle: '' as unknown,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h, this.fillStyle]);
    },
  };
  const modules = encodeDigits('868123456789012345');
  drawQr(ctx, modules, 250);
  assert.deepEqual(rects[0], [0, 0, 250, 250, '#FFFFFF']);
  const dark = rects.slice(1);
  assert.equal(dark.length, modules.flat().filter(Boolean).length);
  for (const [x, y, w, h] of dark) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y));
    assert.equal(w, 10);
    assert.equal(h, 10);
  }
});
