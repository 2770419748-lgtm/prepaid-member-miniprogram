const TWELVE_HOURS = 12 * 60 * 60;

/** 把 12h、15m、7d 或纯秒数转成秒。没配或认不出时用 fallbackSeconds（默认 12 小时）。 */
export function parseExpiresSeconds(value: string | undefined, fallbackSeconds = TWELVE_HOURS): number {
  const raw = (value ?? '').trim();
  const matched = /^(\d+)([smhd])?$/.exec(raw);
  if (!matched) {
    return fallbackSeconds;
  }
  const amount = Number(matched[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallbackSeconds;
  }
  const unit = matched[2] ?? 's';
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * factor;
}

/** 两个小程序（会员、员工都是微信手机号登录）的登录默认 30 天，小程序每天打开时自动续期，常用就一直不用重新登录。 */
export const MINIPROGRAM_DEFAULT_EXPIRES_SECONDS = 30 * 24 * 60 * 60;
