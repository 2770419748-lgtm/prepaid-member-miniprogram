/**
 * 登录凭证存在本机。过期前一分钟就当作已过期，免得请求半路失效。
 * 登录默认 30 天，小程序每天打开时自动续期（utils/keep-login.ts），常用就一直不用重新登录。
 */
const KEY = 'member_session';

/** 每天续一次。凭证本身很短（比如本机配成几小时）时，到有效期的一半就续。 */
export const RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Session {
  token: string;
  expiresAt: number;
  /** 到这个时间就该续期了。升级前存的登录没有这一项，当作该续了。 */
  renewAt?: number;
}

function read(): Session | null {
  const value: unknown = wx.getStorageSync(KEY);
  if (!value || typeof value !== 'object') {
    return null;
  }
  const session = value as Partial<Session>;
  if (typeof session.token !== 'string' || typeof session.expiresAt !== 'number') {
    return null;
  }
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    ...(typeof session.renewAt === 'number' ? { renewAt: session.renewAt } : {}),
  };
}

export function nextRenewAt(now: number, expiresInSeconds: number): number {
  return now + Math.min(RENEW_INTERVAL_MS, Math.max(0, expiresInSeconds) * 500);
}

export function saveSession(token: string, expiresInSeconds: number): void {
  const now = Date.now();
  const session: Session = {
    token,
    expiresAt: now + expiresInSeconds * 1000,
    renewAt: nextRenewAt(now, expiresInSeconds),
  };
  wx.setStorageSync(KEY, session);
}

export function currentToken(): string | null {
  const session = read();
  if (!session || session.expiresAt - 60_000 <= Date.now()) {
    return null;
  }
  return session.token;
}

/** 登录还有效、并且到了续期时间，返回要续的那张凭证；否则返回 null。 */
export function tokenToRenew(now = Date.now()): string | null {
  const token = currentToken();
  const session = read();
  if (!token || !session) {
    return null;
  }
  return typeof session.renewAt !== 'number' || now >= session.renewAt ? token : null;
}

/**
 * 续期拿到新凭证后换上。续期途中退出了或换了手机号登录（本机凭证已经不是发请求时那张），就不覆盖。
 */
export function saveRenewed(previousToken: string, token: string, expiresInSeconds: number): boolean {
  const session = read();
  if (!session || session.token !== previousToken) {
    return false;
  }
  saveSession(token, expiresInSeconds);
  return true;
}

export function clearSession(): void {
  wx.removeStorageSync(KEY);
}

const LOGIN_PAGE = 'pages/login/login';

/** 没登录就去登录页。页面里先调它，返回 false 时不要再请求。 */
export function ensureLogin(): boolean {
  if (currentToken()) {
    return true;
  }
  goLogin();
  return false;
}

/** expired：登录失效被送回去的，登录页会说一声「登录已失效」。 */
export function goLogin(expired = false): void {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current && current.route === LOGIN_PAGE) {
    return;
  }
  wx.reLaunch({ url: `/${LOGIN_PAGE}${expired ? '?expired=1' : ''}` });
}
