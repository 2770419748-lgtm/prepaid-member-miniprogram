/**
 * 防重复提交的请求号。每次打开「确认」弹窗生成一个，网络重试或连点都带同一个号，
 * 后端保证同一个号只记一笔。
 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
