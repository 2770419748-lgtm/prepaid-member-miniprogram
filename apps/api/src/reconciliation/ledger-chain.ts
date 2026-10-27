/** 一只钱包的流水，按记账时间排好。 */
export interface ChainEntry {
  id: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
}

export interface ChainResult {
  /** 前余额接不上上一笔后余额的次数。0 表示整条链连得上。 */
  breaks: number;
  /** 链条最后一笔的后余额；没有流水为 0。 */
  endBalance: number;
}

/**
 * 从 0 开始把流水按「前余额 → 后余额」串起来。
 * 同一时刻记下的几笔（并发时时间可能相同）先后不确定，在这一组里按余额去接，而不是按 ID。
 * 接不上时记一次断点，从这组里剩下最早的一笔继续。
 */
export function walkChain(entries: readonly ChainEntry[]): ChainResult {
  let cursor = 0;
  let breaks = 0;
  let index = 0;
  while (index < entries.length) {
    const time = entries[index].createdAt.getTime();
    let end = index;
    while (end < entries.length && entries[end].createdAt.getTime() === time) {
      end += 1;
    }
    const group = entries.slice(index, end);
    while (group.length > 0) {
      let next = group.findIndex((entry) => entry.balanceBefore === cursor);
      if (next < 0) {
        breaks += 1;
        next = 0;
      }
      cursor = group[next].balanceAfter;
      group.splice(next, 1);
    }
    index = end;
  }
  return { breaks, endBalance: cursor };
}
