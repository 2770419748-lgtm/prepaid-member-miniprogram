/** 登录凭证存在本机。过期前一分钟就当作已过期，免得请求半路失效。 */
const KEY = 'member_session';

interface Session {
  token: string;
  expiresAt: number;
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
  return { token: session.token, expiresAt: session.expiresAt };
}

export function saveSession(token: string, expiresInSeconds: number): void {
  wx.setStorageSync(KEY, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

export function currentToken(): string | null {
  const session = read();
  if (!session || session.expiresAt - 60_000 <= Date.now()) {
    return null;
  }
  return session.token;
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

export function goLogin(): void {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (current && current.route === LOGIN_PAGE) {
    return;
  }
  wx.reLaunch({ url: `/${LOGIN_PAGE}` });
}
