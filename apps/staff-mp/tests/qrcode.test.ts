import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import jsQR from 'jsqr';
import { drawQr, encodeText, utf8Bytes } from '../utils/qrcode';

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

function decode(text: string): string | undefined {
  const { data, size } = render(encodeText(text));
  return jsQR(data, size, size)?.data;
}

test('签署链接编成二维码后能被别的解码器读回原样', () => {
  const links = [
    'https://smlt.esign.cn/flow123',
    'https://smlh5.esign.cn/sign/flowmh2x8k1?t=tmh2x8k2',
    `https://smlh5.esign.cn/guide?context=${'a1B2c3D4'.repeat(30)}&flowId=1234567890&organ=false&appId=7438&linkSource=1`,
  ];
  for (const link of links) {
    assert.equal(decode(link), link);
  }
});

test('中文按 UTF-8 编码，演示码也能读回', () => {
  const text = '储值会员小程序（本机演示码，正式上线后换成小程序码）';
  assert.equal(decode(text), text);
  assert.deepEqual(utf8Bytes('元'), [0xe5, 0x85, 0x83]);
  assert.deepEqual(utf8Bytes('😀'), [0xf0, 0x9f, 0x98, 0x80]);
});

test('短链接用小版本，格子大好扫；长到装不下时报错', () => {
  assert.ok(encodeText('https://smlt.esign.cn/flow123').length <= 29);
  assert.throws(() => encodeText('x'.repeat(3000)), RangeError);
  assert.throws(() => encodeText(''), RangeError);
});

test('画码时先铺白底，格子按整数像素对齐', () => {
  const calls: number[][] = [];
  const ctx = {
    fillStyle: '' as unknown,
    fillRect: (x: number, y: number, w: number, h: number) => calls.push([x, y, w, h]),
  };
  const modules = encodeText('https://smlt.esign.cn/flow123');
  drawQr(ctx, modules, 300);
  assert.deepEqual(calls[0], [0, 0, 300, 300]);
  assert.ok(calls.slice(1).every((call) => call.every((n) => Number.isInteger(n))));
});
