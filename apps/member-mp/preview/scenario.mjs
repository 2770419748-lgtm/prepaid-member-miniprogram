// 会员小程序截图场景。先按真实接口准备演示数据，再逐页截图。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api            # 本机接口，开发环境
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots
//
// 只连本机接口（API_BASE，默认 http://127.0.0.1:3000），会在本机库里建演示门店、演示会员和几笔流水；
// 重复运行不会重复记账。演示账号用种子超级管理员 13800000000（密码默认 Init12345，可用 PREVIEW_STAFF_PASSWORD 改）。

const API = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const STAFF_PHONE = '13800000000';
const STAFF_PASSWORD = process.env.PREVIEW_STAFF_PASSWORD ?? 'Init12345';

const MEMBER_PHONE = '13900001111';
const MEMBER_NAME = '林女士';
const NEW_MEMBER_PHONE = '13900002222';

const STORES = [
  { name: '湖滨店', address: '杭州市上城区湖滨路 18 号', lat: 30.259, lng: 120.164, phone: '0571-88880001', businessHours: '每天 10:00-22:00' },
  { name: '西溪店', address: '杭州市西湖区文二西路 551 号', lat: 30.281, lng: 120.07, phone: '0571-88880002', businessHours: '每天 09:30-21:30' },
  { name: '滨江店', address: '杭州市滨江区江南大道 228 号', lat: 30.21, lng: 120.211, phone: '0571-88880003', businessHours: '周一至周五 10:00-21:00，周末 09:00-22:00' },
];

/** 演示时会员所在位置：离湖滨店不到 1 公里。 */
const HERE = { latitude: 30.265, longitude: 120.17 };

async function call(path, { method = 'GET', token, body } = {}) {
  const reply = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await reply.json().catch(() => null);
  if (!reply.ok) {
    throw new Error(`${method} ${path} → ${reply.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function staffToken() {
  const login = await call('/auth/staff/password/login', {
    method: 'POST',
    body: { phone: STAFF_PHONE, password: STAFF_PASSWORD },
  });
  return login.accessToken;
}

async function memberSession(phone) {
  const login = await call('/auth/member/wx-phone', {
    method: 'POST',
    body: { code: 'preview', phoneCode: 'preview', mockPhone: phone },
  });
  return { token: login.accessToken, expiresAt: Date.now() + login.expiresIn * 1000 };
}

async function prepare() {
  const health = await call('/health').catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`连不上本机接口 ${API}，请先用 WECHAT_PHONE_MOCK=true 启动`);
  }
  const token = await staffToken();

  // 门店：建三家演示门店；种子里的「示例门店」对会员隐藏，免得截图里出现占位名。
  const existing = (await call('/stores?pageSize=100', { token })).items;
  const stores = [];
  for (const store of STORES) {
    const found = existing.find((item) => item.name === store.name);
    stores.push(
      found
        ? await call(`/stores/${found.id}`, { method: 'PATCH', token, body: { ...store, status: 'ACTIVE' } })
        : await call('/stores', { method: 'POST', token, body: store }),
    );
  }
  for (const store of existing) {
    if (!STORES.some((item) => item.name === store.name) && store.status === 'ACTIVE') {
      await call(`/stores/${store.id}`, { method: 'PATCH', token, body: { status: 'DISABLED' } });
    }
  }
  const [hubin, xixi, binjiang] = stores;

  // 会员：林女士在湖滨店开卡；另一位会员只登录过小程序、还没开卡。
  let member = (await call(`/members?phone=${MEMBER_PHONE}`, { token })).items[0];
  if (!member || !member.hasCard) {
    member = await call('/members/open', { method: 'POST', token, body: { phone: MEMBER_PHONE, name: MEMBER_NAME, storeId: hubin.id } });
  }
  const ledger = await call(`/ledger?memberId=${member.id}&pageSize=1`, { token });
  if (ledger.total === 0) {
    const move = (kind, store, amountCent) =>
      call(`/wallets/${member.id}/${kind}`, { method: 'POST', token, body: { storeId: store.id, amountCent, remark: '演示' } });
    await move('recharge', hubin, 100000);
    await move('consume', xixi, 12800);
    const wrong = await move('consume', hubin, 5800);
    await call(`/ledger/${wrong.entry.id}/reversal`, { method: 'POST', token, body: { remark: '金额录错' } });
    await move('consume', hubin, 5080);
    await move('consume', binjiang, 3650);
  }

  const setStatus = async (status) => {
    for (const store of stores) {
      await call(`/stores/${store.id}`, { method: 'PATCH', token, body: { status } });
    }
  };

  return {
    member: await memberSession(MEMBER_PHONE),
    newMember: await memberSession(NEW_MEMBER_PHONE),
    hideStores: () => setStatus('DISABLED'),
    showStores: () => setStatus('ACTIVE'),
  };
}

export default async function scenario() {
  const data = await prepare();
  const signedIn = { member_session: data.member };
  return {
    app: '..',
    sheet: { title: '会员小程序（本机真实接口 + 演示数据）', columns: 4 },
    shots: [
      {
        name: '02-首页',
        caption: '首页：余额、储值说明、可用门店入口、最近明细',
        route: 'pages/login/login',
        storage: { dev_mock_phone: MEMBER_PHONE },
        steps: [
          { shot: '01-登录', caption: '登录：用微信手机号一键登录' },
          { tap: '.btn-primary' },
          { wait: 300 },
          { expectText: '784.70' },
          { expectText: '可用门店 · 3家' },
        ],
      },
      {
        name: '03-首页-还没开卡',
        caption: '还没开卡：余额 0 元，提示到门店开卡',
        route: 'pages/index/index',
        storage: { member_session: data.newMember },
        steps: [{ expectText: '还没开卡' }],
      },
      {
        name: '04-明细',
        caption: '使用明细：按天分组，加绿减红，记错撤销的标「已撤销」',
        route: 'pages/ledger/ledger',
        storage: signedIn,
        steps: [{ expectText: '消费撤销' }, { expectText: '已撤销' }],
      },
      {
        name: '05-明细详情-撤销',
        caption: '撤销记录：白话说明，可查看原记录',
        route: 'pages/ledger/ledger',
        storage: signedIn,
        steps: [{ tap: '.ledger-row', nth: 2 }, { expectText: '已退回您的余额' }],
      },
      {
        name: '06-门店-未定位',
        caption: '可用门店（没开定位）：不显示距离，不排序',
        route: 'pages/index/index',
        storage: signedIn,
        steps: [{ tap: '.entry' }, { expectText: '开启定位' }],
      },
      {
        name: '07-门店-已定位',
        caption: '可用门店（同意定位后）：显示距离，近的在前',
        route: 'pages/index/index',
        storage: signedIn,
        authSetting: { 'scope.userLocation': true },
        location: HERE,
        steps: [{ tap: '.entry' }, { expectText: '距您' }],
      },
      {
        name: '08-导航',
        caption: '点「导航」：打开微信地图，可再选腾讯 / 高德 / 百度导航',
        route: 'pages/index/index',
        storage: signedIn,
        authSetting: { 'scope.userLocation': true },
        location: HERE,
        steps: [{ tap: '.entry' }, { tap: '.store-nav' }, { tap: '.mp-map-go' }],
      },
      {
        name: '09-电话',
        caption: '点「电话」：直接拨打门店电话',
        route: 'pages/index/index',
        storage: signedIn,
        steps: [{ tap: '.entry' }, { tap: '.store-call' }, { expectText: '0571-88880001' }],
      },
      {
        name: '10-门店-空',
        caption: '一家门店都没有时：灰字提示',
        route: 'pages/index/index',
        storage: signedIn,
        before: data.hideStores,
        after: data.showStores,
        steps: [{ expectText: '可用门店 · 0家' }, { tap: '.entry' }, { expectText: '暂无可用门店，请联系商家' }],
      },
      {
        name: '11-我的',
        caption: '我的：只有自己的资料、明细、门店和退出',
        route: 'pages/mine/mine',
        storage: signedIn,
        steps: [{ expectText: MEMBER_NAME }],
      },
    ],
  };
}
