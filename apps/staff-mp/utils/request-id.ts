/**
 * 防重复提交的请求号。每次点「确认」生成一个，网络重试时沿用同一个，
 * 服务端同一个号只记一笔。格式须是 8–64 位字母、数字、`-`、`_`。
 */
export function newRequestId(now: number = Date.now(), random: () => number = Math.random): string {
  let tail = '';
  while (tail.length < 16) {
    tail += Math.floor(random() * 36).toString(36);
  }
  return `smp-${now.toString(36)}-${tail}`;
}
