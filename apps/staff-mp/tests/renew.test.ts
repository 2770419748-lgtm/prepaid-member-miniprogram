import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextRenewAt, RENEW_INTERVAL_MS, renewDue } from '../utils/renew';

const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

test('30 天的登录每天续一次', () => {
  const now = Date.UTC(2026, 10, 1, 1, 0, 0);
  assert.equal(RENEW_INTERVAL_MS, DAY);
  assert.equal(nextRenewAt(now, THIRTY_DAYS_SECONDS), now + DAY);
});

test('有效期很短时到一半就续，不会等到过期', () => {
  const now = Date.UTC(2026, 10, 1, 1, 0, 0);
  assert.equal(nextRenewAt(now, 12 * 60 * 60), now + 6 * 60 * 60 * 1000);
  assert.equal(nextRenewAt(now, 0), now);
});

test('没到时间不续，到了就续', () => {
  const now = Date.UTC(2026, 10, 1, 1, 0, 0);
  const renewAt = nextRenewAt(now, THIRTY_DAYS_SECONDS);
  assert.equal(renewDue({ renewAt }, now), false);
  assert.equal(renewDue({ renewAt }, renewAt - 1), false);
  assert.equal(renewDue({ renewAt }, renewAt), true);
  assert.equal(renewDue({ renewAt }, renewAt + DAY), true);
});

test('升级前存的登录没有续期时间，打开就续', () => {
  assert.equal(renewDue({}, Date.now()), true);
});
