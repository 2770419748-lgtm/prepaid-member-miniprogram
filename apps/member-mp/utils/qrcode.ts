/*
 * 二维码编码（只支持纯数字），供会员码页面在 canvas 上画码。
 *
 * 算法照搬 Project Nayuki 的 QR Code generator library，删掉了用不到的字节、字母数字、汉字模式，
 * 只保留数字模式。原库许可如下：
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

/** 纠错等级：数字越大能容忍的污损越多，码也越密。下标对应 Nayuki 的 ordinal。 */
const ECC = { LOW: 0, MEDIUM: 1, QUARTILE: 2, HIGH: 3 } as const;
type Ecc = (typeof ECC)[keyof typeof ECC];

/** 格式信息里纠错等级的两位编码（L=1, M=0, Q=3, H=2）。 */
const FORMAT_BITS: Record<Ecc, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };

const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;
/** 会员码只有十几位数字，版本 1 到 10 绰绰有余。 */
const MAX_VERSION = 10;

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function appendBits(value: number, length: number, bits: number[]): void {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
}

function numDataCodewords(version: number, ecc: Ecc): number {
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_ERROR_CORRECTION_BLOCKS[ecc][version]
  );
}

/** 数字模式的字符数字段长度：版本 1–9 是 10 位，10–26 是 12 位。 */
function charCountBits(version: number): number {
  return version < 10 ? 10 : 12;
}

function numericBits(digits: string, version: number): number[] {
  const bits: number[] = [];
  appendBits(0x1, 4, bits);
  appendBits(digits.length, charCountBits(version), bits);
  for (let i = 0; i < digits.length; i += 3) {
    const chunk = digits.slice(i, i + 3);
    appendBits(Number(chunk), chunk.length * 3 + 1, bits);
  }
  return bits;
}

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i += 1) {
    result.push(0);
  }
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) {
        result[j] ^= result[j + 1];
      }
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

class Symbol {
  readonly size: number;
  readonly modules: boolean[][] = [];
  private isFunction: boolean[][] = [];

  constructor(
    private readonly version: number,
    private readonly ecc: Ecc,
    dataCodewords: number[],
  ) {
    this.size = version * 4 + 17;
    for (let i = 0; i < this.size; i += 1) {
      this.modules.push(new Array<boolean>(this.size).fill(false));
      this.isFunction.push(new Array<boolean>(this.size).fill(false));
    }
    this.drawFunctionPatterns();
    this.drawCodewords(this.addEccAndInterleave(dataCodewords));
    // 八种掩码都试一遍，选扫码最友好（罚分最低）的那种。
    let best = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.penaltyScore();
      if (penalty < minPenalty) {
        best = mask;
        minPenalty = penalty;
      }
      this.applyMask(mask);
    }
    this.applyMask(best);
    this.drawFormatBits(best);
    this.isFunction = [];
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i += 1) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);
    const positions = this.alignmentPatternPositions();
    const count = positions.length;
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < count; j += 1) {
        if (!((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0))) {
          this.drawAlignmentPattern(positions[i], positions[j]);
        }
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: number): void {
    const data = (FORMAT_BITS[this.ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) {
      this.setFunctionModule(8, i, getBit(bits, i));
    }
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) {
      this.setFunctionModule(14 - i, 8, getBit(bits, i));
    }
    for (let i = 0; i < 8; i += 1) {
      this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i += 1) {
      this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    }
    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) {
      return;
    }
    let rem = this.version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const color = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private setFunctionModule(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  private addEccAndInterleave(data: number[]): number[] {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[this.ecc][this.version];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[this.ecc][this.version];
    const rawCodewords = Math.floor(numRawDataModules(this.version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks: number[][] = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i += 1) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) {
        dat.push(0);
      }
      blocks.push(dat.concat(ecc));
    }
    const result: number[] = [];
    for (let i = 0; i < blocks[0].length; i += 1) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(block[i]);
        }
      });
    }
    return result;
  }

  private drawCodewords(data: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }
      for (let vert = 0; vert < this.size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i += 1;
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y][x] && invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  private penaltyScore(): number {
    let result = 0;
    for (let y = 0; y < this.size; y += 1) {
      result += this.linePenalty((i) => this.modules[y][i]);
    }
    for (let x = 0; x < this.size; x += 1) {
      result += this.linePenalty((i) => this.modules[i][x]);
    }
    for (let y = 0; y < this.size - 1; y += 1) {
      for (let x = 0; x < this.size - 1; x += 1) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }
    let dark = 0;
    for (const row of this.modules) {
      dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    }
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  /** 一行（或一列）里同色连续过长、出现类似定位图形的罚分。 */
  private linePenalty(at: (index: number) => boolean): number {
    let result = 0;
    let runColor = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.size; i += 1) {
      if (at(i) === runColor) {
        run += 1;
        if (run === 5) {
          result += PENALTY_N1;
        } else if (run > 5) {
          result += 1;
        }
      } else {
        this.addHistory(run, history);
        if (!runColor) {
          result += this.countFinderLike(history) * PENALTY_N3;
        }
        runColor = at(i);
        run = 1;
      }
    }
    if (runColor) {
      this.addHistory(run, history);
      run = 0;
    }
    run += this.size;
    this.addHistory(run, history);
    result += this.countFinderLike(history) * PENALTY_N3;
    return result;
  }

  private countFinderLike(history: number[]): number {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  }

  private addHistory(run: number, history: number[]): void {
    if (history[0] === 0) {
      run += this.size;
    }
    history.pop();
    history.unshift(run);
  }

  private alignmentPatternPositions(): number[] {
    if (this.version === 1) {
      return [];
    }
    const numAlign = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }
}

/**
 * 把一串数字编成二维码，返回方格矩阵（true 为黑）。
 * 选能装下的最小版本；版本不变的前提下把纠错等级尽量提高，码被手指挡住一角也能扫。
 */
export function encodeDigits(digits: string): boolean[][] {
  if (!/^\d+$/.test(digits)) {
    throw new RangeError('只能编码数字');
  }
  let version = 1;
  let bits = numericBits(digits, version);
  while (bits.length > numDataCodewords(version, ECC.LOW) * 8) {
    version += 1;
    if (version > MAX_VERSION) {
      throw new RangeError('数字太长');
    }
    bits = numericBits(digits, version);
  }
  let ecc: Ecc = ECC.LOW;
  for (const higher of [ECC.MEDIUM, ECC.QUARTILE, ECC.HIGH]) {
    if (bits.length <= numDataCodewords(version, higher) * 8) {
      ecc = higher;
    }
  }
  const capacity = numDataCodewords(version, ecc) * 8;
  appendBits(0, Math.min(4, capacity - bits.length), bits);
  appendBits(0, (8 - (bits.length % 8)) % 8, bits);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bits);
  }
  const codewords: number[] = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => {
    codewords[i >>> 3] |= bit << (7 - (i & 7));
  });
  return new Symbol(version, ecc, codewords).modules;
}

/** canvas 2d 上下文里画码用到的那几个方法。真机和测试里的假画布都满足。 */
export interface QrContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/**
 * 在边长 sizePx 的正方形里画码，四周留 2 格白边（外面的白卡片再补足扫码需要的空白）。
 * 每格按整数像素对齐，避免格子之间出现细缝。
 */
export function drawQr(ctx: QrContext, modules: boolean[][], sizePx: number): void {
  const quiet = 2;
  const cells = modules.length + quiet * 2;
  const cell = Math.floor(sizePx / cells);
  const offset = Math.floor((sizePx - cell * modules.length) / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.fillStyle = '#0F172A';
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        ctx.fillRect(offset + x * cell, offset + y * cell, cell, cell);
      }
    });
  });
}
