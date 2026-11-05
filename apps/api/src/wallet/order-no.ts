import { formatYuan } from '../common/money-words';

/**
 * 收银系统（九讯云）订单号。小票上印「单号：5982」，订单条码（Code 128）里是「A5982」。
 * 店员扫码读到的、手输的（带不带 A、带不带前导 0、大小写）都整理成同一种写法，同一张单才认得出是同一张。
 * 只认 A 开头的零售单：手机串号（15 位）、商品 69 码（13 位）位数超过 10，会被拒。
 */

/** 规范写法：A + 不以 0 开头的 1~10 位数字。和迁移里的 CHECK 约束一致。 */
export const ORDER_NO_PATTERN = /^A[1-9]\d{0,9}$/;

/** 接口收什么：可带 A（大小写都行），1~10 位数字，前后空格不算。 */
export const ORDER_NO_INPUT_PATTERN = /^\s*[Aa]?\d{1,10}\s*$/;

export const ORDER_NO_MESSAGE = '订单号不对：请扫九讯云小票上的订单条码，或输入小票上的单号';

/** 整理成规范写法；不是订单号返回 null。 */
export function normalizeOrderNo(raw: string): string | null {
  const match = /^A?(\d{1,10})$/.exec(raw.replace(/\s+/g, '').toUpperCase());
  if (!match) {
    return null;
  }
  const digits = match[1].replace(/^0+/, '');
  return digits ? `A${digits}` : null;
}

/** 一笔消费最多能抵商品应付金额的 10%，向下取整到分。 */
export const ORDER_OFFSET_PERCENT = 10;

/** 一张订单最多抵 1000 元（坤总 2026-11-05）。和迁移里的 CHECK 约束一致，改它要连迁移一起改。 */
export const ORDER_OFFSET_MAX_CENT = 100_000;

/** 这张单最多能抵多少：商品应付金额的 10%（向下取整到分），且不超过 1000 元。 */
export function maxOffsetCent(productAmountCent: number): number {
  return Math.min(Math.floor((productAmountCent * ORDER_OFFSET_PERCENT) / 100), ORDER_OFFSET_MAX_CENT);
}

/** 抵扣超过上限时给店员看的提示：说清楚是被 10% 还是被 1000 元卡住。 */
export function offsetCapMessage(productAmountCent: number): string {
  const cap = maxOffsetCent(productAmountCent);
  return cap >= ORDER_OFFSET_MAX_CENT
    ? `这单最多只能抵 ${formatYuan(cap)} 元（一张单最多抵 ${formatYuan(ORDER_OFFSET_MAX_CENT)} 元）`
    : `这单最多只能抵 ${formatYuan(cap)} 元（商品金额 ${formatYuan(productAmountCent)} 元的 ${ORDER_OFFSET_PERCENT}%）`;
}
