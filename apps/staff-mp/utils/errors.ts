/** 接口失败时给店员看的白话。不显示状态码和英文技术信息。 */
export class ApiError extends Error {
  constructor(
    /** HTTP 状态码。0 表示网络没通，不知道服务端有没有收到。 */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 请求可能已经到了服务端：带同一个请求号重试才安全。 */
  get uncertain(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

const NETWORK = '网络不稳定，请检查网络后重试';
const SERVER = '系统开小差了，请稍后再试';
const INVALID = '提交的内容有误，请检查后重试';

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/** 服务端错误体是 `{ statusCode, message }`，message 可能是字符串或校验信息数组。 */
export function errorMessage(status: number, body: unknown): string {
  if (status === 0) {
    return NETWORK;
  }
  if (status >= 500) {
    return SERVER;
  }
  const raw = body && typeof body === 'object' && 'message' in body ? (body as { message: unknown }).message : null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first === 'string' && hasChinese(first)) {
    return first;
  }
  return status === 401 ? '登录已过期，请重新登录' : INVALID;
}

export function toApiError(status: number, body: unknown): ApiError {
  return new ApiError(status, errorMessage(status, body));
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return SERVER;
}
