// 会员看自己的纸质协议单（坤总 2026-11-05：不签电子合同了，门店拍照上传顾客签字的纸质协议单，会员在小程序里能看）。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api        # 本机接口，开发环境，开单方式默认就是纸质协议单
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/paper-scenario.mjs --out /tmp/paper-shots
//
// 只连本机接口（API_BASE，默认 http://127.0.0.1:3000），会在本机库里建一家演示门店、一位演示会员，
// 由店员（种子超级管理员 13800000000，按小程序的方式用假微信手机号登录）给他上传一份协议单并充值。
// 照片用 preview/fixtures 里画的演示样张，没有真实个人信息。重复运行不会重复开单。

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const STAFF_PHONE = '13800000000';
const MEMBER = { phone: '13900005555', name: '吴女士' };
const STORE = { name: '湖滨店', address: '杭州市上城区湖滨路 18 号', businessHours: '每天 10:00-22:00' };
const PLAN = {
  title: '储值会员权益',
  summary: '储值后全部门店通用',
  items: [
    { title: '全场配件 9 折', detail: '储值消费自动按折后价记账' },
    { title: '贴膜免费', detail: '限会员本人手机' },
  ],
  rules: '储值终身有效，用完为止。余额不能提现。',
};
const PHOTOS = ['agreement-demo-1.jpg', 'agreement-demo-2.jpg'];

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function prepare() {
  const health = await call('/health');
  if (health.esignProductionEnabled) {
    throw new Error('本机接口打开了正式签署开关，截图只用测试环境');
  }
  const staff = await call('/auth/staff/wx-phone', {
    method: 'POST',
    body: { code: 'preview', phoneCode: 'preview', mockPhone: STAFF_PHONE },
  });
  const token = staff.accessToken;
  const { mode } = await call('/sign-flows/config', { token });
  if (mode !== 'PAPER') {
    throw new Error('本机接口的开单方式不是纸质协议单，去掉 SIGN_MODE=esign 再跑');
  }

  const stores = (await call('/stores?pageSize=100', { token })).items;
  const store = stores.find((item) => item.name === STORE.name) ?? (await call('/stores', { method: 'POST', token, body: STORE }));
  const plans = (await call('/benefit-plans?pageSize=100', { token })).items;
  const plan = plans.find((item) => item.title === PLAN.title) ?? (await call('/benefit-plans', { method: 'POST', token, body: { ...PLAN, status: 'ACTIVE' } }));
  if (plan.status !== 'ACTIVE') {
    await call(`/benefit-plans/${plan.id}`, { method: 'PATCH', token, body: { status: 'ACTIVE' } });
  }

  const found = (await call(`/members?phone=${MEMBER.phone}&pageSize=1`, { token })).items[0];
  const member = found?.hasCard ? found : await call('/members/open', { method: 'POST', token, body: { ...MEMBER, storeId: store.id } });
  const flows = (await call(`/sign-flows?memberId=${member.id}&pageSize=20`, { token })).items;
  if (!flows.some((flow) => flow.kind === 'PAPER')) {
    const photoIds = [];
    for (const name of PHOTOS) {
      const form = new FormData();
      form.append('file', new Blob([await readFile(new URL(`./fixtures/${name}`, import.meta.url))], { type: 'image/jpeg' }), name);
      const res = await fetch(`${API}/sign-flows/photos`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) throw new Error(`上传协议单照片 → ${res.status} ${await res.text()}`);
      photoIds.push((await res.json()).id);
    }
    await call('/sign-flows/paper', {
      method: 'POST',
      token,
      body: { memberId: member.id, storeId: store.id, benefitPlanId: plan.id, rechargeAmountCent: 200000, photoIds, requestId: randomUUID() },
    });
  }

  const login = await call('/auth/member/wx-phone', {
    method: 'POST',
    body: { code: 'preview', phoneCode: 'preview', mockPhone: MEMBER.phone },
  });
  return { member_session: { token: login.accessToken, expiresAt: Date.now() + login.expiresIn * 1000 } };
}

export default async function scenario() {
  const signedIn = await prepare();
  return {
    app: '..',
    sheet: { title: '会员看自己的纸质协议单', columns: 4 },
    shots: [
      {
        name: '01-首页',
        caption: '首页：门店上传协议单后会员权益金额已到账，权益显示「已签署」',
        route: 'pages/index/index',
        storage: signedIn,
        steps: [{ expectText: '2,000.00' }],
      },
      {
        name: '02-我的权益单',
        caption: '我的权益单：在门店签的标「纸质」',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        steps: [{ expectText: '纸质' }],
      },
      {
        name: '03-协议单详情',
        caption: '协议单详情：签字的协议单照片、会员权益金额已充值、权益内容和规则',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        fullPage: true,
        steps: [{ tap: '.flow-row:has-text("纸质")' }, { wait: 600 }, { expectText: '点照片可以放大看' }],
      },
      {
        name: '04-看大图',
        caption: '点照片放大看',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        steps: [{ tap: '.flow-row:has-text("纸质")' }, { wait: 600 }, { tap: '.photo-cell .photo' }, { wait: 300 }],
      },
      {
        name: '05-会员权益',
        caption: '会员权益：签过协议单的方案标「已签署」',
        route: 'pages/benefits/benefits',
        storage: signedIn,
        steps: [{ expectText: '已签署' }],
      },
    ],
  };
}
