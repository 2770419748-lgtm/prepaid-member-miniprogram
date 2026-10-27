import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const ESIGN_JSON = 'application/json; charset=UTF-8';
export const ESIGN_ACCEPT = '*/*';

/** 请求体的 Content-MD5：MD5 摘要再 Base64。没有请求体时为空串。 */
export function contentMd5(body: string | Buffer | null): string {
  if (body === null || body.length === 0) {
    return '';
  }
  return createHash('md5').update(body).digest('base64');
}

/**
 * e签宝 v3 请求签名的原文：
 * 方法、Accept、Content-MD5、Content-Type、Date 各占一行，再接路径（带按名排序的查询参数）。
 * 没有自定义签名头，所以不加 Headers 段。
 */
export function stringToSign(input: {
  method: string;
  pathWithQuery: string;
  contentMd5: string;
  contentType: string;
  accept?: string;
  date?: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.accept ?? ESIGN_ACCEPT,
    input.contentMd5,
    input.contentType,
    input.date ?? '',
    input.pathWithQuery,
  ].join('\n');
}

/** 路径 + 按参数名排序的查询串。空值只留参数名。 */
export function signedPath(path: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) {
    return path;
  }
  const parts = Object.keys(query)
    .sort()
    .map((key) => (query[key] === '' ? key : `${key}=${query[key]}`));
  return `${path}?${parts.join('&')}`;
}

/** HMAC-SHA256，密钥为应用 Secret，结果 Base64。放在 X-Tsign-Open-Ca-Signature。 */
export function requestSignature(secret: string, toSign: string): string {
  return createHmac('sha256', secret).update(toSign, 'utf8').digest('base64');
}

/**
 * 回调验签：HMAC-SHA256(时间戳 + 按参数名排序拼接的参数值 + 原始请求体)，小写十六进制。
 * 时间戳取 X-Tsign-Open-TIMESTAMP，签名取 X-Tsign-Open-SIGNATURE。
 */
export function callbackSignature(
  secret: string,
  timestamp: string,
  query: Record<string, string | undefined>,
  rawBody: Buffer,
): string {
  const queryValues = Object.keys(query)
    .sort()
    .map((key) => query[key] ?? '')
    .join('');
  return createHmac('sha256', secret)
    .update(Buffer.from(timestamp, 'utf8'))
    .update(Buffer.from(queryValues, 'utf8'))
    .update(rawBody)
    .digest('hex');
}

/** 定长比较，避免按耗时猜签名。大小写不敏感。 */
export function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(actual.trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
