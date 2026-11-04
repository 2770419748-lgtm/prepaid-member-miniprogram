import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { fake, relaunched, storage } from './support/fake-wx';
import { request as staffRequest } from '../staff/utils/http';
import { loadSession as loadStaffSession } from '../staff/utils/session';
import { currentLanding, currentMode, landingFor, setMode, signOut } from '../utils/mode';
import { request as memberRequest } from '../utils/request';
import { currentToken, saveSession } from '../utils/session';

// 会员和员工共用一个小程序：打开时去哪一边、退出登录、某一边登录失效时怎么办。

const replies: { statusCode: number; data: unknown }[] = [];

Object.assign((globalThis as unknown as { wx: Record<string, unknown> }).wx, {
  request: (options: { success: (res: { statusCode: number; data: unknown }) => void }) => {
    options.success(replies.shift() ?? { statusCode: 200, data: {} });
  },
});

function saveStaff(expiresAt = Date.now() + 3600_000): void {
  storage.set('staff.session', {
    token: 'staff-token',
    expiresAt,
    staff: { id: 's1', orgId: 'o1', phone: '13800000001', name: '李晓', status: 'ACTIVE' },
    access: { unrestricted: false, stores: [] },
    storeId: null,
  });
}

beforeEach(() => {
  storage.clear();
  relaunched.length = 0;
  replies.length = 0;
  fake.pages = [{ route: 'pages/index/index' }];
});

test('打开小程序时先回上次用的那一边，那边登录没了就去另一边，都没有才登录', () => {
  assert.equal(landingFor({ mode: 'member', hasStaff: false, hasMember: false }), 'login');
  assert.equal(landingFor({ mode: 'member', hasStaff: false, hasMember: true }), 'member');
  assert.equal(landingFor({ mode: 'member', hasStaff: true, hasMember: false }), 'staff');
  assert.equal(landingFor({ mode: 'member', hasStaff: true, hasMember: true }), 'member');
  assert.equal(landingFor({ mode: 'staff', hasStaff: true, hasMember: true }), 'staff');
  // 员工被停用（员工登录没了），有会员登录就只剩会员页。
  assert.equal(landingFor({ mode: 'staff', hasStaff: false, hasMember: true }), 'member');
  assert.equal(landingFor({ mode: 'staff', hasStaff: false, hasMember: false }), 'login');
});

test('按本机存的登录判断：员工切到自己的会员卡后两张登录都在，回到上次那一边', () => {
  assert.equal(currentMode(), 'member');
  assert.equal(currentLanding(), 'login');

  saveStaff();
  setMode('staff');
  assert.equal(currentLanding(), 'staff');

  saveSession('member-token', 3600);
  setMode('member');
  assert.equal(currentLanding(), 'member');
  setMode('staff');
  assert.equal(currentLanding(), 'staff');

  // 员工登录过期了：回会员页。
  saveStaff(Date.now() - 1000);
  assert.equal(currentLanding(), 'member');
});

test('退出登录把会员、员工两边的登录一起清掉', () => {
  saveStaff();
  saveSession('member-token', 3600);
  setMode('staff');
  signOut();
  assert.equal(loadStaffSession(), null);
  assert.equal(currentToken(), null);
  assert.equal(currentMode(), 'member');
  assert.deepEqual(relaunched, ['/pages/login/login']);
});

test('用工作台时会员登录在后台失效：只清掉会员登录，不打断工作台', async () => {
  saveStaff();
  saveSession('member-token', 3600);
  setMode('staff');
  replies.push({ statusCode: 401, data: { message: '登录已失效' } });
  await assert.rejects(memberRequest('/members/me'));
  assert.equal(currentToken(), null);
  assert.ok(loadStaffSession());
  assert.deepEqual(relaunched, []);
});

test('用会员页时会员登录失效：回登录页', async () => {
  saveSession('member-token', 3600);
  setMode('member');
  replies.push({ statusCode: 401, data: {} });
  await assert.rejects(memberRequest('/members/me'));
  assert.equal(currentToken(), null);
  assert.deepEqual(relaunched, ['/pages/login/login']);
});

test('看自己的会员卡时员工登录失效（比如被停用）：只清掉员工登录，会员页照常', async () => {
  saveStaff();
  saveSession('member-token', 3600);
  setMode('member');
  replies.push({ statusCode: 401, data: {} });
  await assert.rejects(staffRequest('POST', '/auth/staff/session/renew'));
  assert.equal(loadStaffSession(), null);
  assert.equal(currentToken(), 'member-token');
  assert.deepEqual(relaunched, []);
});

test('用工作台时员工登录失效：回登录页', async () => {
  saveStaff();
  setMode('staff');
  replies.push({ statusCode: 401, data: {} });
  await assert.rejects(staffRequest('GET', '/staff/me/stores'));
  assert.equal(loadStaffSession(), null);
  assert.equal(relaunched.length, 1);
  assert.equal(relaunched[0], '/pages/login/login');
});
