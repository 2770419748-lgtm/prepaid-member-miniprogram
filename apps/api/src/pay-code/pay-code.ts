import { createHash, randomInt } from 'node:crypto';

/**
 * 会员码的样子：18 位数字，以 8 开头，最后一位是校验位（Luhn）。
 * 二维码里只放这串数字。数字短，二维码格子就大，手机摄像头好扫。
 */
const PREFIX = '8';
const RANDOM_DIGITS = 16;
export const PAY_CODE_LENGTH = PREFIX.length + RANDOM_DIGITS + 1;

/** 没扫的码多久作废。会员小程序每半分钟换一次，所以正常出示时码只活半分钟左右。 */
export const PAY_CODE_TTL_MS = 60_000;
/** 会员小程序隔多久换一张新码。 */
export const PAY_CODE_REFRESH_MS = 30_000;
/** 店员扫码以后，要在多久之内扣款。过了要让会员刷新再扫。 */
export const PAY_CODE_CLAIM_MS = 5 * 60_000;

function luhnDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    let digit = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return String((10 - (sum % 10)) % 10);
}

export function generatePayCode(): string {
  let body = PREFIX;
  for (let i = 0; i < RANDOM_DIGITS; i += 1) {
    body += String(randomInt(10));
  }
  return body + luhnDigit(body);
}

/** 扫到的内容去掉空白后是不是一张会员码。不是就返回空，别的二维码（收款码、网址）都会落到这里。 */
export function normalizePayCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '');
  if (code.length !== PAY_CODE_LENGTH || !/^\d+$/.test(code) || !code.startsWith(PREFIX)) {
    return null;
  }
  return luhnDigit(code.slice(0, -1)) === code.slice(-1) ? code : null;
}

/** 库里只存哈希。码一分钟就过期，又是随机数，不用加盐。 */
export function hashPayCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
