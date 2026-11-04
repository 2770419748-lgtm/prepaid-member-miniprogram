/** 只留数字，去掉 86 国家码。与服务端 `normalizePhone` 一致。 */
export function normalizePhone(input: string): string {
  const digits = input.trim().replace(/[^\d]/g, '');
  if (digits.startsWith('86') && digits.length === 13) {
    return digits.slice(2);
  }
  return digits;
}

/** 与服务端 `assertMainlandMobile` 一致：1 开头的 11 位。 */
export function isMainlandMobile(phone: string): boolean {
  return /^1\d{10}$/.test(phone);
}

/** 中间四位打码：13800138000 → 138****8000。不是 11 位时原样返回。 */
export function maskPhone(phone: string): string {
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}
