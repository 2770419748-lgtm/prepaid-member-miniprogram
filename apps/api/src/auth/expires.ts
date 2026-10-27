/** 把 12h、15m、7d 或纯秒数转成秒。认不出时用 12 小时。 */
export function parseExpiresSeconds(value: string | undefined): number {
  const fallback = 12 * 60 * 60;
  const raw = (value ?? '12h').trim();
  const matched = /^(\d+)([smhd])?$/.exec(raw);
  if (!matched) {
    return fallback;
  }
  const amount = Number(matched[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallback;
  }
  const unit = matched[2] ?? 's';
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * factor;
}
