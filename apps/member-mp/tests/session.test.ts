import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { fake, relaunched, storage } from './support/fake-wx';
import { devMockPhone } from '../utils/config';
import { friendlyMessage } from '../utils/request';
import { clearSession, currentToken, ensureLogin, saveSession } from '../utils/session';

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
