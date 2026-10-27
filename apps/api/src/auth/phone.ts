import { BadRequestException } from '@nestjs/common';

/** 去掉空格和 +86 前缀，得到 11 位大陆手机号。 */
export function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/[^\d]/g, '');
  if (digits.startsWith('86') && digits.length === 13) {
    return digits.slice(2);
  }
  return digits;
}

export function assertMainlandMobile(phone: string): void {
  if (!/^1\d{10}$/.test(phone)) {
    throw new BadRequestException('手机号格式不正确');
  }
}
