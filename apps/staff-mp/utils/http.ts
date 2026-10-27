import { apiBase } from './env';
import { ApiError, toApiError } from './errors';
import { clearSession, loadSession, LOGIN_PAGE } from './session';

type Method = 'GET' | 'POST';
type Query = Record<string, string | number | undefined | null>;

function queryString(query: Query | undefined): string {
  if (!query) {
    return '';
  }
  const parts = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

let redirectingToLogin = false;

function backToLogin(): void {
  clearSession();
  if (redirectingToLogin) {
    return;
  }
  redirectingToLogin = true;
  wx.reLaunch({
    url: LOGIN_PAGE,
    complete: () => {
      redirectingToLogin = false;
    },
  });
}

/**
 * 调用服务端接口。登录失效时清掉本机登录状态并回到登录页。
 * 失败一律抛 `ApiError`，message 是能直接给店员看的白话。
 */
export function request<T>(
  method: Method,
  path: string,
  /** token：刚登录、还没存进本机时显式带上；auth=false 不带登录凭证。 */
  options: { query?: Query; body?: object; auth?: boolean; token?: string } = {},
): Promise<T> {
  const auth = options.auth ?? true;
  const header: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const token = options.token ?? loadSession()?.token;
    if (!token) {
      backToLogin();
      return Promise.reject(new ApiError(401, '登录已过期，请重新登录'));
    }
    header.Authorization = `Bearer ${token}`;
  }
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${apiBase()}${path}${queryString(options.query)}`,
      method,
      header,
      data: options.body,
      timeout: 15000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }
        if (res.statusCode === 401 && auth) {
          backToLogin();
        }
        reject(toApiError(res.statusCode, res.data));
      },
      fail: () => reject(toApiError(0, null)),
    });
  });
}
