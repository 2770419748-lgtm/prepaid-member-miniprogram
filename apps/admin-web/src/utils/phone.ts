/** 手机号中间四位打码：13800138000 → 138****8000。 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) {
    return '';
  }
  if (phone.length !== 11) {
    return phone;
  }
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

/** 去掉空格、横线和 +86，得到 11 位手机号。 */
export function normalizePhone(input: string): string {
  let text = input.replace(/[\s-]/g, '');
  if (text.startsWith('+86')) {
    text = text.slice(3);
  }
  return text;
}

export function isMobile(input: string): boolean {
  return /^1\d{10}$/.test(normalizePhone(input));
}
