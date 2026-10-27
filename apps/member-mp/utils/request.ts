import { apiBase } from './config';
import { clearSession, currentToken, goLogin } from './session';

/** 给会员看的错误。message 已经是白话，可以直接显示。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const CHINESE = /[一-龥]/;

/** 只把接口给的中文提示直接给会员看；英文校验信息和错误码一律换成白话。 */
export function friendlyMessage(body: unknown, status: number): string {
  const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  if (typeof message === 'string' && CHINESE.test(message)) {
    return message;
  }
  if (status === 0) {
    return '网络不太好，请稍后再试';
  }
  if (status >= 500) {
    return '服务暂时不可用，请稍后再试';
  }
  return '没有办成，请稍后再试';
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  data?: Record<string, string | number | boolean | undefined>;
  /** 登录接口传 false，不带凭证、401 也不跳登录页。 */
  auth?: boolean;
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth !== false;
  const header: Record<string, string> = { 'content-type': 'application/json' };
  const token = auth ? currentToken() : null;
  if (token) {
    header.Authorization = `Bearer ${token}`;
  }
  const data: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(options.data ?? {})) {
    if (value !== undefined) {
      data[key] = value;
    }
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase()}${path}`,
      method: options.method ?? 'GET',
      data,
      header,
      timeout: 15000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }
        if (res.statusCode === 401 && auth) {
          clearSession();
          goLogin();
          reject(new ApiError('登录已过期，请重新登录', 401));
          return;
        }
        reject(new ApiError(friendlyMessage(res.data, res.statusCode), res.statusCode));
      },
      fail() {
        reject(new ApiError(friendlyMessage(null, 0), 0));
      },
    });
  });
}

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : '没有办成，请稍后再试';
}
