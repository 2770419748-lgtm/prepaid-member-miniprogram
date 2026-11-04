/**
 * 员工小程序的登录默认 30 天，小程序每天第一次打开时在后台续一次（有效期从那时重新算），
 * 天天用就一直不用重新登录。连续 30 天没打开过，才要重新点「微信手机号登录」。
 */
export const RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 登录或续期后，下次什么时候续：一天后。凭证本身很短（比如本机配成几小时）时取有效期的一半。 */
export function nextRenewAt(now: number, expiresInSeconds: number): number {
  return now + Math.min(RENEW_INTERVAL_MS, Math.max(0, expiresInSeconds) * 500);
}

/** 到没到续期时间。升级前存的登录没有 renewAt，当作该续了。 */
export function renewDue(session: { renewAt?: number }, now: number): boolean {
  return typeof session.renewAt !== 'number' || now >= session.renewAt;
}
