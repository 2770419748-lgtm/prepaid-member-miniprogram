// 会员和员工共用一个小程序（2026-11-04 合并）的截图场景：同一个登录页，顾客进会员页、店员直接进工作台，
// 店员能切到自己的会员卡再回来，员工停用后只剩会员页。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/merged-scenario.mjs --out /tmp/merged-shots
//
// 只连本机接口（API_BASE，默认 http://localhost:3000），会往本机数据库写一家演示门店、几位员工和会员，建议用一个空的本地库。
// 演示用的超级管理员是 prisma/seed.ts 建的 13800000000。不要对着任何正式环境跑。

import { randomUUID } from 'node:crypto';

const API = process.env.API_BASE ?? 'http://localhost:3000';
const SUPER_ADMIN = '13800000000';
const STORE = { name: '春熙路店', address: '锦江区春熙路 88 号', businessHours: '10:00-22:00' };
/** 店员，自己也在店里办了卡。 */
const CLERK = { phone: '13900003001', name: '王小雨' };
/** 普通顾客。 */
const CUSTOMER = { phone: '13900003100', name: '赵女士' };
/** 先当顾客用过小程序，后来入职。 */
const NEW_HIRE = { phone: '13900003200', name: '孙晨' };
/** 离职、账号已停用的员工。 */
const LEAVER = { phone: '13900003300', name: '周凯' };
const DEMO_PASSWORD = 'Demo12345';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function mockLogin(path, phone) {
  return call('POST', path, { body: { code: 'preview', phoneCode: 'preview', mockPhone: phone } });
}

/** 和 utils/session.ts 的 saveSession 存的结构一致。 */
function memberSession(login) {
  const now = Date.now();
  return { token: login.accessToken, expiresAt: now + login.expiresIn * 1000, renewAt: now + 24 * 3600 * 1000 };
}

/** 和 staff/utils/session.ts 的 saveLogin 存的结构一致。 */
async function staffSession(phone, storeId) {
  const login = await mockLogin('/auth/staff/wx-phone', phone);
  const access = await call('GET', '/staff/me/stores', { token: login.accessToken });
  return {
    login,
    stored: {
      token: login.accessToken,
      expiresAt: Date.now() + (login.expiresIn - 60) * 1000,
      staff: login.staff,
      access,
      storeId,
    },
  };
}

async function setup() {
  const admin = (await mockLogin('/auth/staff/wx-phone', SUPER_ADMIN)).accessToken;
  const stores = (await call('GET', '/stores?pageSize=100', { token: admin })).items;
  const storeId = (stores.find((store) => store.name === STORE.name) ?? (await call('POST', '/stores', { token: admin, body: STORE }))).id;

  // 新入职的那位先当顾客登录过小程序。
  const asCustomerBeforeHire = await mockLogin('/auth/member/wx-phone', NEW_HIRE.phone);

  const staff = (await call('GET', '/staff?pageSize=100', { token: admin })).items;
  for (const person of [CLERK, NEW_HIRE, LEAVER]) {
    const found = staff.find((item) => item.phone === person.phone);
    if (!found) {
      await call('POST', '/staff', { token: admin, body: { ...person, storeId, role: 'STAFF', password: DEMO_PASSWORD } });
    }
  }
  const leaverId = (await call('GET', '/staff?pageSize=100', { token: admin })).items.find(
    (item) => item.phone === LEAVER.phone,
  ).id;
  await call('PATCH', `/staff/${leaverId}`, { token: admin, body: { status: 'DISABLED' } });

  // 店员自己和顾客都在店里开了卡、充了钱。
  for (const [person, yuan] of [
    [CLERK, 300],
    [CUSTOMER, 520],
  ]) {
    const page = await call('GET', `/members?phone=${person.phone}&pageSize=1`, { token: admin });
    let member = page.items[0];
    if (!member?.hasCard) {
      member = await call('POST', '/members/open', { token: admin, body: { phone: person.phone, name: person.name, storeId } });
      await call('POST', `/wallets/${member.id}/recharge`, {
        token: admin,
        body: { storeId, amountCent: yuan * 100, requestId: randomUUID(), remark: '演示充值' },
      });
    }
  }

  const clerk = await staffSession(CLERK.phone, storeId);
  const customer = await mockLogin('/auth/wx-phone', CUSTOMER.phone);
  return { storeId, clerk, customer, asCustomerBeforeHire };
}

export default async function scenario() {
  const demo = await setup();
  const asClerk = { 'staff.session': demo.clerk.stored, app_mode: 'staff' };

  return {
    app: '..',
    sheet: { title: '会员和员工合并成一个小程序', columns: 4 },
    shots: [
      {
        name: '01-登录页',
        caption: '1. 打开小程序都是这一页，顾客和店员都点「手机号快捷登录」，顾客看不到任何员工入口',
        route: 'pages/login/login',
        steps: [{ expectText: '手机号快捷登录' }],
      },
      {
        name: '02-顾客登录进会员首页',
        caption: '2. 普通顾客登录：跟原来一样进会员首页，看余额、出示会员码',
        route: 'pages/login/login',
        storage: { dev_mock_phone: CUSTOMER.phone },
        steps: [{ tap: '.btn-primary' }, { wait: 500 }, { expectText: '可用余额' }, { expectText: '520.00' }],
      },
      {
        name: '03-店员登录直接进工作台',
        caption: '3. 店员用同一个按钮登录，直接进工作台',
        route: 'pages/login/login',
        storage: { dev_mock_phone: CLERK.phone },
        steps: [
          { tap: '.btn-primary' },
          { wait: 600 },
          { expectText: '扫码消费' },
          { expectText: '本店流水' },
          { expectText: '切到我的会员卡' },
          {
            shot: '03-店员登录直接进工作台',
            caption: '3. 店员用同一个按钮登录：认出是后台开过的员工手机号，直接进工作台，底部换成工作台三栏；最下面能切到自己的会员卡',
          },
          { tap: '.mycard' },
          { wait: 600 },
          { expectText: '可用余额' },
          { expectText: '300.00' },
          { shot: '04-切到自己的会员卡', caption: '4. 点了直接进自己的会员首页（不用再点手机号授权），看余额、出示会员码' },
          { tap: '.mp-tab[data-path="pages/mine/mine"]' },
          { wait: 500 },
          { expectText: '回到工作台' },
          { shot: '05-会员我的-回到工作台', caption: '5. 会员「我的」里多一行「回到工作台」，只有员工看得到' },
          { tap: '.menu-item:has-text("回到工作台")' },
          { wait: 600 },
          { expectText: '扫码消费' },
          { shot: '06-回到工作台', caption: '6. 一点就回工作台，员工登录一直在，不用重新登录' },
        ],
        capture: false,
      },
      {
        name: '07-工作台我的',
        caption: '7. 工作台「我的」：也能切到会员卡；退出登录会把两边一起退掉',
        route: 'staff/pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 400 }, { expectText: '切到我的会员卡' }, { expectText: '王小雨' }],
      },
      {
        name: '08-普通会员的我的',
        caption: '8. 普通顾客的「我的」：没有任何工作台入口，跟原来一样',
        route: 'pages/mine/mine',
        storage: { member_session: memberSession(demo.customer) },
        steps: [{ wait: 500 }, { expectText: '退出登录' }],
      },
      {
        name: '09-老顾客入职后',
        caption: '9. 先当顾客用过、后来入职的：「我的」里出现「进入工作台」，点了重新登录一次就进',
        route: 'pages/mine/mine',
        storage: { member_session: memberSession(demo.asCustomerBeforeHire), app_mode: 'member' },
        steps: [
          { wait: 500 },
          { expectText: '进入工作台' },
          { shot: '09-老顾客入职后', caption: '9. 先当顾客用过、后来入职的：「我的」里出现「进入工作台」，点了重新登录一次就进' },
          { tap: '.menu-item:has-text("进入工作台")' },
          { wait: 200 },
          { expectText: '重新登录' },
          { shot: '10-进入工作台提示', caption: '10. 提示用微信手机号重新登录一次（安全起见，换身份要重新验证手机号）' },
        ],
        capture: false,
      },
      {
        name: '11-离职员工再登录',
        caption: '11. 后台停用了的员工再登录：只进会员页，看不到工作台',
        route: 'pages/login/login',
        storage: { dev_mock_phone: LEAVER.phone },
        steps: [{ tap: '.btn-primary' }, { wait: 600 }, { expectText: '还没开卡' }],
      },
    ],
  };
}
