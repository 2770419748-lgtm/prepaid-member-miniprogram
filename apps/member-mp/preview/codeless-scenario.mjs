// 店长无码抵扣截图场景（坤总 2026-11-07）：顾客出示不了会员码时，本店店长按手机号找到会员直接抵扣。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/codeless-scenario.mjs --out /tmp/codeless-shots
//
// 只连本机接口（API_BASE，默认 http://localhost:3000），会往本机数据库写演示门店、员工、会员和流水。
// 演示用的超级管理员是 prisma/seed.ts 建的 13800000000。不要对着任何正式环境跑。最好用一个新建的空库。

import { randomUUID } from 'node:crypto';

const API = process.env.API_BASE ?? 'http://localhost:3000';
const SUPER_ADMIN = '13800000000';
const MANAGER = { phone: '13900000001', name: '陈店长' };
const CLERK = { phone: '13900000002', name: '李晓' };
const STORES = [
  { name: '滨江店', address: '滨江区江南大道 100 号', businessHours: '10:00-22:00' },
  { name: '西湖店', address: '西湖区文三路 200 号', businessHours: '10:00-21:30' },
];
const WANG = { phone: '13812345678', name: '王女士' };
const ZHANG = { phone: '13687654321', name: '张先生' };
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

async function staffLogin(phone) {
  const login = await call('POST', '/auth/staff/wx-phone', {
    body: { code: 'preview', phoneCode: 'preview', mockPhone: phone },
  });
  const access = await call('GET', '/staff/me/stores', { token: login.accessToken });
  return { login, access };
}

/** 与 staff/utils/session.ts 的 saveLogin 存的结构一致。 */
function sessionFor({ login, access }, storeId) {
  return {
    token: login.accessToken,
    expiresAt: Date.now() + (login.expiresIn - 60) * 1000,
    staff: login.staff,
    access,
    storeId,
  };
}

async function memberSession(phone) {
  const login = await call('POST', '/auth/member/wx-phone', {
    body: { code: 'preview', phoneCode: 'preview', mockPhone: phone },
  });
  return { token: login.accessToken, expiresAt: Date.now() + login.expiresIn * 1000 };
}

async function ensureMember(token, storeId, { phone, name }) {
  const page = await call('GET', `/members?phone=${phone}&pageSize=1`, { token });
  if (page.items[0]?.hasCard) {
    return { member: page.items[0], fresh: false };
  }
  return { member: await call('POST', '/members/open', { token, body: { phone, name, storeId } }), fresh: true };
}

async function freshOrder(token, start) {
  for (let n = start; ; n += 1) {
    const checked = await call('GET', `/orders/check?orderNo=A${n}`, { token });
    if (!checked.redeemed) {
      return checked.orderNo;
    }
  }
}

/** 店员扫码抵扣一笔（对照用：普通的扫码消费）。 */
async function scanConsume(token, member, storeId, amountCent, productAmountCent) {
  const issued = await call('POST', '/members/me/pay-code', { token: (await memberSession(member.phone)).token });
  await call('POST', '/pay-codes/scan', { token, body: { code: issued.code, storeId } });
  return call('POST', `/wallets/${member.id}/consume`, {
    token,
    body: {
      storeId,
      amountCent,
      productAmountCent,
      payCode: issued.code,
      orderNo: await freshOrder(token, 7100),
      requestId: randomUUID(),
    },
  });
}

async function setup() {
  const admin = (await staffLogin(SUPER_ADMIN)).login.accessToken;
  const stores = (await call('GET', '/stores?pageSize=100', { token: admin })).items;
  const storeIds = [];
  for (const spec of STORES) {
    const found = stores.find((store) => store.name === spec.name);
    storeIds.push(found ? found.id : (await call('POST', '/stores', { token: admin, body: spec })).id);
  }
  const [binjiang] = storeIds;
  const staff = (await call('GET', '/staff?pageSize=100', { token: admin })).items;
  for (const person of [MANAGER, CLERK]) {
    if (!staff.some((item) => item.phone === person.phone)) {
      await call('POST', '/staff', {
        token: admin,
        body: { ...person, storeId: binjiang, role: person === MANAGER ? 'STORE_MANAGER' : 'STAFF', password: DEMO_PASSWORD },
      });
    }
  }
  const clerk = await staffLogin(CLERK.phone);
  const manager = await staffLogin(MANAGER.phone);
  const managerToken = manager.login.accessToken;

  const wang = await ensureMember(clerk.login.accessToken, binjiang, WANG);
  if (wang.fresh) {
    await call('POST', `/wallets/${wang.member.id}/recharge`, {
      token: managerToken,
      body: { storeId: binjiang, amountCent: 100_000, remark: '现金', requestId: randomUUID() },
    });
    await scanConsume(clerk.login.accessToken, { ...wang.member, ...WANG }, binjiang, 4_550, 45_500);
  }
  // 张先生：前几天店长给他做过一笔填了单号的无码抵扣，会员端和后台都看得到。
  const zhang = await ensureMember(clerk.login.accessToken, binjiang, ZHANG);
  let zhangCodeless = null;
  if (zhang.fresh) {
    await call('POST', `/wallets/${zhang.member.id}/recharge`, {
      token: managerToken,
      body: { storeId: binjiang, amountCent: 50_000, remark: '转账', requestId: randomUUID() },
    });
    zhangCodeless = (
      await call('POST', `/wallets/${zhang.member.id}/consume-codeless`, {
        token: managerToken,
        body: {
          storeId: binjiang,
          amountCent: 9_990,
          productAmountCent: 99_900,
          orderNo: (await freshOrder(managerToken, 6021)).slice(1),
          orderNoTyped: true,
          remark: '手机没电',
          requestId: randomUUID(),
        },
      })
    ).entry;
  } else {
    const found = await call('GET', `/ledger?memberId=${zhang.member.id}&codeless=true&pageSize=1`, { token: managerToken });
    zhangCodeless = found.items[0];
  }
  return {
    binjiang,
    clerk,
    manager,
    wangBalance: (await call('GET', `/members/${wang.member.id}`, { token: managerToken })).balanceCent,
    zhangCodelessId: zhangCodeless.id,
    zhangSession: await memberSession(ZHANG.phone),
  };
}

function yuan(cent) {
  const text = Math.floor(cent / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${text}.${(cent % 100).toString().padStart(2, '0')}`;
}

export default async function scenario() {
  const demo = await setup();
  const asClerk = { 'staff.session': sessionFor(demo.clerk, demo.binjiang), app_mode: 'staff' };
  const asManager = { 'staff.session': sessionFor(demo.manager, demo.binjiang), app_mode: 'staff' };
  const findWang = [
    { fill: ['.search-input', WANG.phone] },
    { tap: '.search-btn' },
    { wait: 400 },
    { expectText: '余额（全公司门店通用）' },
  ];
  return {
    app: '..',
    sheet: { title: '店长无码抵扣（顾客出示不了会员码时）', columns: 4 },
    shots: [
      {
        name: '01-店员的会员页',
        caption: '1. 店员查到会员：只有「扫码消费」，没有无码抵扣',
        route: 'staff/pages/index/index',
        storage: asClerk,
        steps: [
          ...findWang,
          {
            run: async (page) => {
              if (await page.locator('.codeless-entry:visible').count()) {
                throw new Error('店员不该看到无码抵扣');
              }
            },
          },
        ],
      },
      {
        name: '02-店长的会员页',
        caption: '2. 店长输手机号查到会员：「扫码消费」下面多一行「无码抵扣 · 店长权限」',
        route: 'staff/pages/index/index',
        storage: asManager,
        steps: [
          ...findWang,
          { expectText: '无码抵扣' },
          { expectText: '顾客没带手机、出示不了会员码时用' },
          { shot: '02-店长的会员页', caption: '2. 店长输手机号查到会员：「扫码消费」下面多一行「无码抵扣 · 店长权限」' },
          { tap: '.codeless-entry:visible' },
          { wait: 400 },
          { expectText: '顾客出示不了会员码时才用' },
          { expectText: '九讯云订单（选填）' },
          { shot: '03-无码抵扣页', caption: '3. 无码抵扣页：顶部提醒只在顾客出示不了会员码时用；会员码写「没扫」，九讯云单号选填' },
          { fill: ['.product-input:visible', '1299'] },
          { expectText: '最多可抵 129.90 元（商品金额的 10%）' },
          { expectText: '先写无码原因' },
          { scroll: 400 },
          { shot: '04-还没写原因', caption: '4. 照样填商品应付金额，最多抵 10%、一单 1000 元；没写原因按钮是灰的' },
          { tap: '.reason-chip:visible' },
          { expectText: '确认无码抵扣 129.90 元' },
          { shot: '05-选好原因', caption: '5. 原因必填，点常用原因一下就填好（也可以自己写），会员看不到' },
          { tap: '.page > .btn-primary:visible' },
          { expectText: '没扫会员码，记在你名下' },
          { shot: '06-二次确认', caption: '6. 确认框写明没扫会员码、记在店长名下、抵多少、剩多少、原因' },
          { tap: '.mp-modal-confirm' },
          { wait: 500 },
          { expectText: '抵扣成功' },
          { expectText: '无码抵扣（没扫会员码）' },
          { expectText: `${yuan(demo.wangBalance - 12_990)} 元` },
          { shot: '07-抵扣成功', caption: '7. 抵扣成功：写明办理方式是无码抵扣，和原因' },
          { tap: '.done ~ .btn-primary:visible' },
          { wait: 500 },
          { expectText: '消费 · 无码抵扣' },
          { shot: '08-会员页记录', caption: '8. 回到会员页，记录里这笔叫「消费 · 无码抵扣」，和扫码消费分得开' },
          { tap: '.list .row:visible' },
          { wait: 400 },
          { expectText: '无码原因' },
          { shot: '09-流水详情', caption: '9. 流水详情：标「没扫会员码」，办理方式、经办人、无码原因都在；记错了照样冲正' },
        ],
        capture: false,
      },
      {
        name: '10-本店流水',
        caption: '10. 本店流水里无码抵扣单独叫出来，店长每天能抽查',
        route: 'staff/pages/ledger/ledger',
        storage: asManager,
        steps: [{ wait: 400 }, { expectText: '消费 · 无码抵扣' }],
      },
      {
        name: '11-会员看到的明细',
        caption: '11. 会员自己的明细：写明「未出示会员码，门店按手机号办理」，不是自己办的能发现（看不到经办人和原因）',
        route: `pages/ledger-detail/ledger-detail?id=${demo.zhangCodelessId}`,
        storage: { member_session: demo.zhangSession },
        steps: [{ wait: 400 }, { expectText: '未出示会员码，门店按手机号办理' }],
      },
    ],
  };
}
