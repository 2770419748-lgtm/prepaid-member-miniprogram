/**
 * 消费抵扣对应的收银订单（九讯云小票）。坤总 2026-11-05：店员扫完会员码再扫订单码，
 * 填商品应付金额，最多抵 10%；同一张单全公司只能抵一次。规则见 docs/backend/order-offset.md。
 *
 * 小票上印「单号：5982」，上方订单条码（Code 128）里是「A5982」。
 * 扫码只认 A 开头的条码；手输可以只输数字。整理成和服务端一样的写法（A + 不以 0 开头的数字）。
 */

export type ReadOrder = { ok: true; orderNo: string } | { ok: false; reason: string };

/** 一笔最多抵商品应付金额的 10%。 */
export const OFFSET_PERCENT = 10;

function normalize(digits: string): string | null {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed ? `A${trimmed}` : null;
}

/** 摄像头扫到的条码内容。 */
export function readScannedOrder(raw: string): ReadOrder {
  const text = raw.replace(/\s+/g, '').toUpperCase();
  const match = /^A(\d{1,10})$/.exec(text);
  const orderNo = match ? normalize(match[1]) : null;
  if (orderNo) {
    return { ok: true, orderNo };
  }
  if (/^\d{15}$/.test(text)) {
    return { ok: false, reason: '扫到的是手机串号，请扫九讯云小票上方的订单条码' };
  }
  if (/^\d{13}$/.test(text)) {
    return { ok: false, reason: '扫到的是商品条码，请扫九讯云小票上方的订单条码' };
  }
  return { ok: false, reason: '这不是订单条码，请扫九讯云小票上方的订单条码' };
}

/** 条码扫不出来时店员照小票手输的单号：只输数字就行，带 A 也认。 */
export function readTypedOrder(input: string): ReadOrder {
  const text = input.replace(/\s+/g, '').toUpperCase();
  if (!text) {
    return { ok: false, reason: '请输入小票上的单号' };
  }
  const match = /^A?(\d{1,10})$/.exec(text);
  const orderNo = match ? normalize(match[1]) : null;
  return orderNo ? { ok: true, orderNo } : { ok: false, reason: '单号只能是数字，照小票上「单号」那一行输入' };
}

/** 最多能抵多少：商品应付金额的 10%，向下取整到分。 */
export function maxOffsetCent(productAmountCent: number): number {
  return Math.floor((productAmountCent * OFFSET_PERCENT) / 100);
}

/** 默认抵多少：能抵满就抵满，余额不够就抵余额。 */
export function defaultOffsetCent(productAmountCent: number, balanceCent: number): number {
  return Math.max(0, Math.min(maxOffsetCent(productAmountCent), balanceCent));
}
