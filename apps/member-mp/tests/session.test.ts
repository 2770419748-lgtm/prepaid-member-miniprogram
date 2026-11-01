import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { fake, relaunched, storage } from './support/fake-wx';
import { devMockPhone } from '../utils/config';
import { friendlyMessage } from '../utils/request';
import {
  clearSession,
  currentToken,
  ensureLogin,
  nextRenewAt,
  RENEW_INTERVAL_MS,
  saveRenewed,
  saveSession,
  tokenToRenew,
} from '../utils/session';

beforeEach(() => {
  storage.clear();
  relaunched.length = 0;
  fake.pages = [{ route: 'pages/index/index' }];
});

test('有效凭证可用；快过期（剩不到一分钟）当作已过期', () => {
  saveSession('token-a', 3600);
  assert.equal(currentToken(), 'token-a');
  saveSession('token-b', 30);
  assert.equal(currentToken(), null);
});

test('没登录就去登录页，已在登录页不重复跳', () => {
  assert.equal(ensureLogin(), false);
  assert.deepEqual(relaunched, ['/pages/login/login']);
  fake.pages = [{ route: 'pages/login/login' }];
  assert.equal(ensureLogin(), false);
  assert.equal(relaunched.length, 1);
  saveSession('token', 3600);
  assert.equal(ensureLogin(), true);
  clearSession();
  assert.equal(currentToken(), null);
});

test('30 天的登录每天续一次；有效期很短时到一半就续', () => {
  const now = Date.UTC(2026, 10, 1, 1, 0, 0);
  assert.equal(RENEW_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(nextRenewAt(now, 30 * 24 * 60 * 60), now + RENEW_INTERVAL_MS);
  assert.equal(nextRenewAt(now, 12 * 60 * 60), now + 6 * 60 * 60 * 1000);
});

test('刚登录不续；到了续期时间才续；升级前存的登录打开就续', () => {
  saveSession('token-a', 30 * 24 * 60 * 60);
  assert.equal(tokenToRenew(), null);
  assert.equal(tokenToRenew(Date.now() + RENEW_INTERVAL_MS + 1000), 'token-a');

  storage.set('member_session', { token: 'old', expiresAt: Date.now() + 3600_000 });
  assert.equal(tokenToRenew(), 'old');

  clearSession();
  assert.equal(tokenToRenew(Date.now() + RENEW_INTERVAL_MS * 2), null);
});

test('续期拿到的新凭证换上；中途退出或换了人登录就不覆盖', () => {
  saveSession('token-a', 30 * 24 * 60 * 60);
  assert.equal(saveRenewed('token-a', 'token-b', 30 * 24 * 60 * 60), true);
  assert.equal(currentToken(), 'token-b');
  assert.equal(tokenToRenew(), null);

  assert.equal(saveRenewed('token-a', 'token-c', 30 * 24 * 60 * 60), false);
  assert.equal(currentToken(), 'token-b');

  clearSession();
  assert.equal(saveRenewed('token-b', 'token-d', 30 * 24 * 60 * 60), false);
  assert.equal(currentToken(), null);
});

test('假手机号只认开发版里格式正确的号码', () => {
  assert.equal(devMockPhone(), null);
  storage.set('dev_mock_phone', '12345');
  assert.equal(devMockPhone(), null);
  storage.set('dev_mock_phone', '13800138000');
  assert.equal(devMockPhone(), '13800138000');
});

test('错误提示：中文原样给会员看，英文和错误码换成白话', () => {
  assert.equal(friendlyMessage({ message: '流水不存在' }, 404), '流水不存在');
  assert.equal(friendlyMessage({ message: ['page must be an integer'] }, 400), '没有办成，请稍后再试');
  assert.equal(friendlyMessage({ message: 'Internal server error' }, 500), '服务暂时不可用，请稍后再试');
  assert.equal(friendlyMessage(null, 0), '网络不太好，请稍后再试');
});
