import { createHash, randomInt } from 'node:crypto';

/**
 * 测试里给每笔消费配一张收银订单（坤总 2026-11-05：消费必须带订单号，最多抵商品金额的 10%）。
 * 商品金额是抵扣的 10 倍，正好能抵满。给了 seed（通常是请求号）时同一个 seed 给同一张单，
 * 这样同一请求号的重试、并发提交还是同一笔；没给时每次一张新单。
 */
export function testOrder(amountCent: unknown, seed?: string): { orderNo: string; productAmountCent: number } {
  const digits = seed
    ? (Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 12), 16) % 900_000_000) + 100_000_000
    : randomInt(100_000_000, 1_000_000_000);
  const productAmountCent =
    typeof amountCent === 'number' && Number.isInteger(amountCent) && amountCent > 0
      ? Math.min(amountCent * 10, 100_000_000)
      : 100_000;
  return { orderNo: `A${digits}`, productAmountCent };
}
