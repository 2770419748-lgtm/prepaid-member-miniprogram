import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'pm-admin-token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token: string | null = readToken();
let onUnauthorized: (() => void) | null = null;
let onMustChangePassword: (() => void) | null = null;

/** 服务端：还没改掉初始密码时，除改密码、看本人信息外的接口都返回这个代码。 */
export const MUST_CHANGE_PASSWORD = 'MUST_CHANGE_PASSWORD';

export function setToken(value: string | null): void {
  token = value;
  try {
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // 浏览器禁用了本地存储：只在本页有效，刷新后重新登录。
  }
}

export function getToken(): string | null {
  return token;
}

/** 登录过期时怎么处理（清会话、回登录页），由会话模块注册。 */
export function handleUnauthorized(handler: () => void): void {
  onUnauthorized = handler;
}

/** 服务端说要先改初始密码时怎么处理（跳改密页），由路由注册。 */
export function handleMustChangePassword(handler: () => void): void {
  onMustChangePassword = handler;
}

/** 接口因为还没改初始密码被拒。 */
export function isMustChangePassword(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) {
    return false;
  }
  const data = error.response.data as { code?: unknown } | undefined;
  return data?.code === MUST_CHANGE_PASSWORD;
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || 'http://localhost:3000',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isLogin = error.config?.url?.includes('/auth/staff/password/login');
    if (error.response?.status === 401 && token && !isLogin) {
      onUnauthorized?.();
    } else if (isMustChangePassword(error)) {
      onMustChangePassword?.();
    }
    return Promise.reject(error);
  },
);

/** 接口不存在（对应模块还没上线）。 */
export function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/** 网络断了或超时，服务器可能已经收到也可能没收到。 */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

export function errorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/**
 * 把接口错误翻成给店员看的一句话。后端的业务错误本来就是中文白话，直接用；
 * 格式校验（英文的字段错误）和服务器故障换成通用说法，不把技术细节露出来。
 */
export function errorMessage(error: unknown, fallback = '操作没有成功，请稍后再试'): string {
  if (!axios.isAxiosError(error)) {
    return fallback;
  }
  if (!error.response) {
    return '连不上服务器，请检查网络后重试';
  }
  const status = error.response.status;
  if (status >= 500) {
    return '系统出了点问题，请稍后再试';
  }
  const data = error.response.data as { message?: unknown } | undefined;
  const message = data?.message;
  if (typeof message === 'string' && /[一-龥]/.test(message)) {
    return message;
  }
  if (status === 400) {
    return '填写的内容格式不对，请检查后再试';
  }
  if (status === 401) {
    return '登录已过期，请重新登录';
  }
  if (status === 403) {
    return '没有权限执行这个操作';
  }
  if (status === 404) {
    return '没有找到对应的记录';
  }
  if (status === 409) {
    return '数据刚被别人改过，请刷新后再试';
  }
  return fallback;
}
