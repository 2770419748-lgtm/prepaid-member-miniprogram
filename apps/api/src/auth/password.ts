import { BadRequestException } from '@nestjs/common';
import { compare, hash, hashSync } from 'bcryptjs';

/** bcrypt 成本。哈希与 bcrypt 兼容。 */
export const PASSWORD_ROUNDS = 10;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const DUMMY_HASH = hashSync('staff-password-dummy', PASSWORD_ROUNDS);

export function assertPasswordPolicy(password: string): void {
  if (password.length < 8 || password.length > 64 || Buffer.byteLength(password) > 72) {
    throw new BadRequestException('密码需要 8 到 64 位');
  }
}

export function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, PASSWORD_ROUNDS);
}

/** 没有密码时也走一次比对，避免用响应时间判断账号是否存在。 */
export async function passwordMatches(password: string, passwordHash: string | null): Promise<boolean> {
  const ok = await compare(password, passwordHash ?? DUMMY_HASH);
  return passwordHash != null && ok;
}

export function lockActive(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}

/** nextCount 是这次失败之后的累计次数。满 5 次则锁定 15 分钟并清零计数。 */
export function lockAfterFailure(
  nextCount: number,
  now: Date,
): { failedLoginCount: number; lockedUntil: Date | null; locked: boolean } {
  if (nextCount >= LOGIN_FAILURE_LIMIT) {
    return {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS),
      locked: true,
    };
  }
  return { failedLoginCount: nextCount, lockedUntil: null, locked: false };
}
