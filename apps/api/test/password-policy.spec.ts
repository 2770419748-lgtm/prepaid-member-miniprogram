import { lockActive, lockAfterFailure, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_MS } from '../src/auth/password';

describe('staff password lockout', () => {
  const now = new Date('2026-10-27T08:00:00.000Z');

  it('locks for 15 minutes on the fifth consecutive failure and resets the counter', () => {
    const fourth = lockAfterFailure(LOGIN_FAILURE_LIMIT - 1, now);
    expect(fourth.locked).toBe(false);
    expect(fourth.failedLoginCount).toBe(4);
    expect(fourth.lockedUntil).toBeNull();

    const fifth = lockAfterFailure(LOGIN_FAILURE_LIMIT, now);
    expect(fifth.locked).toBe(true);
    expect(fifth.failedLoginCount).toBe(0);
    expect(fifth.lockedUntil?.getTime()).toBe(now.getTime() + LOGIN_LOCK_MS);
  });

  it('treats an expired lock as open', () => {
    const until = new Date(now.getTime() + LOGIN_LOCK_MS);
    expect(lockActive(until, now)).toBe(true);
    expect(lockActive(until, new Date(until.getTime()))).toBe(false);
    expect(lockActive(null, now)).toBe(false);
  });
});