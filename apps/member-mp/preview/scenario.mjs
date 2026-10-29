// 会员小程序截图场景。先按真实接口准备演示数据，再逐页截图。
//
//   pnpm --filter member-mp exec tsx preview/fake-esign.mjs        # 本机假电子签平台（3901，控制口 3902）
//   WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 \
//   ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api # 本机接口，开发环境，指向假电子签平台
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots
//
// 只连本机接口（API_BASE，默认 http://127.0.0.1:3000），会在本机库里建演示门店、演示会员、几笔流水和权益单；
// 重复运行不会重复记账。演示账号用种子超级管理员 13800000000，按员工小程序的方式用（假）微信手机号登录：
// 网页后台的初始密码登录在改密前什么都做不了，脚本不碰它。
// 「签署」演示每次用一位新会员（手机号按时间生成），这样每次都从「待签署」开始。
// 消费都按真机的顺序走：会员出示会员码 → 门店扫码 → 带着会员码扣款。「会员码」演示用另一位会员，每次跑都会扣一笔。

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ESIGN_CONTROL = (process.env.FAKE_ESIGN_CONTROL ?? 'http://127.0.0.1:3902').replace(/\/$/, '');
const jsQR = createRequire(import.meta.url)('jsqr');
/** 和 preview/fake-esign.mjs 里登记的演示模板一致。 */
const ESIGN_TEMPLATE_ID = 'member-benefit-demo';
const STAFF_PHONE = '13800000000';

const MEMBER_PHONE = '13900001111';
const MEMBER_NAME = '林女士';
const NEW_MEMBER_PHONE = '13900002222';
const SIGNER_NAME = '陈先生';
const PAYER_PHONE = '13900003333';
const PAYER_NAME = '周女士';

const STORES = [
  { name: '湖滨店', address: '杭州市上城区湖滨路 18 号', lat: 30.259, lng: 120.164, phone: '0571-88880001', businessHours: '每天 10:00-22:00' },
  { name: '西溪店', address: '杭州市西湖区文二西路 551 号', lat: 30.281, lng: 120.07, phone: '0571-88880002', businessHours: '每天 09:30-21:30' },
  { name: '滨江店', address: '杭州市滨江区江南大道 228 号', lat: 30.21, lng: 120.211, phone: '0571-88880003', businessHours: '周一至周五 10:00-21:00，周末 09:00-22:00' },
];

/** 演示时会员所在位置：离湖滨店不到 1 公里。 */
const HERE = { latitude: 30.265, longitude: 120.17 };

// 演示用的权益方案。正式内容由商家在后台填写，这里只是为了截图有东西可看。
const PLANS = [
  {
    plan: {
      title: '储值会员权益',
      summary: '开卡即享，全部门店通用',
      items: [
        { title: '全部门店通用', detail: '余额在每一家门店都能用' },
        { title: '储值长期有效', detail: '不过期，用完为止' },
        { title: '每笔都能查', detail: '充值、消费都记在小程序明细里' },
        { title: '会员活动优先', detail: '门店活动先通知会员' },
      ],
      rules: '储值金额只能在本商家门店使用，不能提现，也不能转给他人。\n充值和消费都在门店办理，以门店记账为准。\n对明细有疑问时，请联系办理的门店核对。',
    },
    template: '储值会员权益确认单',
  },
  {
    plan: {
      title: '会员专享服务',
      summary: '到店享受的会员服务',
      items: [
        { title: '预约优先安排', detail: '提前致电门店预约' },
        { title: '专属顾问', detail: '固定一位门店顾问跟进' },
      ],
      rules: '服务内容以门店当日安排为准。',
    },
    template: '会员专享服务确认单',
  },
];

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
  const login = await call('/auth/staff/wx-phone', {
    method: 'POST',
    body: { code: 'preview', phoneCode: 'preview', mockPhone: STAFF_PHONE },
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

/** 会员出示会员码、门店扫码，返回码里的那串数字。超级管理员在哪家门店都能扫。 */
async function scanFor(memberToken, staffToken, storeId) {
  const { code } = await call('/members/me/pay-code', { method: 'POST', token: memberToken });
  await call('/pay-codes/scan', { method: 'POST', token: staffToken, body: { code, storeId } });
  return code;
}

/** 门店扫码以后扣款：消费必须带着刚扫的会员码。 */
async function consumeWithCode(memberToken, staffToken, memberId, storeId, amountCent, remark = '演示') {
  const payCode = await scanFor(memberToken, staffToken, storeId);
  return call(`/wallets/${memberId}/consume`, { method: 'POST', token: staffToken, body: { storeId, amountCent, remark, payCode, requestId: randomUUID() } });
}

/** 认出会员码页上画的二维码，和店员手机扫到的一样。 */
async function readQr(page) {
  const image = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    const canvas = canvases[canvases.length - 1];
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { width: canvas.width, height: canvas.height, data: btoa(binary) };
  });
  const found = jsQR(new Uint8ClampedArray(Buffer.from(image.data, 'base64')), image.width, image.height);
  if (!found) throw new Error('会员码页上的二维码认不出来');
  return found.data;
}

/** 让假电子签平台把这位会员所有待签的权益单标成签好了（相当于会员在签署页签完）。 */
async function completeSigning(phone) {
  const reply = await fetch(`${ESIGN_CONTROL}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  }).catch(() => null);
  if (!reply || !reply.ok) {
    throw new Error(`连不上假电子签平台 ${ESIGN_CONTROL}，请先运行 preview/fake-esign.mjs`);
  }
}

/** 权益方案和权益单模板：按名称找，没有就建。 */
async function ensureTemplates(token) {
  const plans = (await call('/benefit-plans?pageSize=100', { token })).items;
  const templates = (await call('/contract-templates?pageSize=100', { token })).items;
  const result = [];
  for (const { plan, template } of PLANS) {
    const foundPlan = plans.find((item) => item.title === plan.title);
    const saved = foundPlan
      ? await call(`/benefit-plans/${foundPlan.id}`, { method: 'PATCH', token, body: { ...plan, status: 'ACTIVE' } })
      : await call('/benefit-plans', { method: 'POST', token, body: plan });
    const foundTemplate = templates.find((item) => item.name === template);
    result.push(
      foundTemplate ??
        (await call('/contract-templates', {
          method: 'POST',
          token,
          body: { esignTemplateId: ESIGN_TEMPLATE_ID, name: template, benefitPlanId: saved.id },
        })),
    );
  }
  return result;
}

function flowsOf(token, memberId, templateId) {
  return call(`/sign-flows?memberId=${memberId}&templateId=${templateId}&pageSize=100`, { token }).then((page) => page.items);
}

async function prepare() {
  const health = await call('/health').catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`连不上本机接口 ${API}，请先用 WECHAT_PHONE_MOCK=true 启动`);
  }
  if (health.esignProductionEnabled) {
    throw new Error('本机接口打开了正式签署开关，截图只用测试环境，请关掉 ESIGN_PRODUCTION_ENABLED');
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
  const memberLogin = await memberSession(MEMBER_PHONE);
  const ledger = await call(`/ledger?memberId=${member.id}&pageSize=1`, { token });
  if (ledger.total === 0) {
    const consume = (store, amountCent) => consumeWithCode(memberLogin.token, token, member.id, store.id, amountCent);
    await call(`/wallets/${member.id}/recharge`, { method: 'POST', token, body: { storeId: hubin.id, amountCent: 100000, remark: '演示', requestId: randomUUID() } });
    await consume(xixi, 12800);
    const wrong = await consume(hubin, 5800);
    await call(`/ledger/${wrong.entry.id}/reversal`, { method: 'POST', token, body: { remark: '金额录错', requestId: randomUUID() } });
    await consume(hubin, 5080);
    await consume(binjiang, 3650);
  }

  // 会员码演示：周女士在湖滨店开卡，余额不够 100 元就补充值，保证每次都扣得了。
  let payer = (await call(`/members?phone=${PAYER_PHONE}`, { token })).items[0];
  if (!payer || !payer.hasCard) {
    payer = await call('/members/open', { method: 'POST', token, body: { phone: PAYER_PHONE, name: PAYER_NAME, storeId: hubin.id } });
  }
  if ((await call(`/members/${payer.id}`, { token })).balanceCent < 10000) {
    await call(`/wallets/${payer.id}/recharge`, { method: 'POST', token, body: { storeId: hubin.id, amountCent: 50000, remark: '演示', requestId: randomUUID() } });
  }
  const payerLogin = await memberSession(PAYER_PHONE);

  // 权益单：林女士签过「储值会员权益」；「会员专享服务」发错了被门店撤销。
  const [basic, extra] = await ensureTemplates(token);
  const basicFlows = await flowsOf(token, member.id, basic.id);
  if (!basicFlows.some((flow) => flow.status === 'SIGNED')) {
    const flow =
      basicFlows.find((item) => item.status === 'PENDING') ??
      (await call('/sign-flows', { method: 'POST', token, body: { memberId: member.id, templateId: basic.id, storeId: hubin.id } }));
    await completeSigning(MEMBER_PHONE);
    await call(`/sign-flows/${flow.id}/refresh`, { method: 'POST', token });
  }
  if ((await flowsOf(token, member.id, extra.id)).length === 0) {
    const flow = await call('/sign-flows', { method: 'POST', token, body: { memberId: member.id, templateId: extra.id, storeId: hubin.id } });
    await call(`/sign-flows/${flow.id}/cancel`, { method: 'POST', token, body: { reason: '发错了，改天重新办理' } });
  }

  // 签署演示：一位新会员，店员刚给他开单，会员权益金额 500 元，签完合同才充值。
  const signerPhone = `139${String(Date.now()).slice(-8)}`;
  const signer = await call('/members/open', { method: 'POST', token, body: { phone: signerPhone, name: SIGNER_NAME, storeId: hubin.id } });
  const signerFlow = await call('/sign-flows', {
    method: 'POST',
    token,
    body: { memberId: signer.id, templateId: basic.id, storeId: hubin.id, rechargeAmountCent: 50000, requestId: randomUUID() },
  });

  const setStatus = async (status) => {
    for (const store of stores) {
      await call(`/stores/${store.id}`, { method: 'PATCH', token, body: { status } });
    }
  };

  return {
    member: memberLogin,
    payer: payerLogin,
    /** 店员在湖滨店扫这张会员码。 */
    staffScans: async (code) => {
      await call('/pay-codes/scan', { method: 'POST', token, body: { code, storeId: hubin.id } });
    },
    /** 扫码后店员填好金额提交。 */
    staffConsumes: (code, amountCent) =>
      call(`/wallets/${payer.id}/consume`, { method: 'POST', token, body: { storeId: hubin.id, amountCent, remark: '演示', payCode: code, requestId: randomUUID() } }),
    newMember: await memberSession(NEW_MEMBER_PHONE),
    signer: await memberSession(signerPhone),
    signerFlowId: signerFlow.id,
    signerSigns: () => completeSigning(signerPhone),
    hideStores: () => setStatus('DISABLED'),
    showStores: () => setStatus('ACTIVE'),
  };
}

/** 北京时间的日期，和小程序里 dayKey 一致。 */
function beijingDay() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function scenario() {
  const data = await prepare();
  let payerCode = '';
  const signedIn = { member_session: data.member };
  const signer = { member_session: data.signer };
  return {
    app: '..',
    sheet: { title: '会员小程序（本机真实接口 + 演示数据）', columns: 4 },
    shots: [
      {
        name: '02-首页',
        caption: '首页：余额、会员码入口、会员权益摘要（已签署）、可用门店入口、最近明细',
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
        caption: '还没开卡：余额 0 元，提示到门店开卡；权益提示到店办理后生效',
        route: 'pages/index/index',
        storage: { member_session: data.newMember },
        steps: [{ expectText: '还没开卡' }],
      },
      {
        name: '06-会员码-消费成功',
        caption: '门店扣完款：会员码页马上显示扣了多少、在哪家店、还剩多少',
        route: 'pages/index/index',
        storage: { member_session: data.payer },
        steps: [
          { tap: '.mc-code' },
          { waitFor: 'canvas' },
          { expectText: '每 30 秒自动更新' },
          { shot: '04-会员码', caption: '会员码：到店消费时出示，门店用手机扫码后才能扣款；每 30 秒换一张新码，截图不能用' },
          {
            run: async (page) => {
              const code = await readQr(page);
              const shown = await page.evaluate(() => window.__mp.current().code);
              if (code !== shown) throw new Error(`二维码里是 ${code}，页面上的码是 ${shown}`);
              await data.staffScans(code);
              payerCode = code;
            },
          },
          { wait: 2600 },
          { expectText: '湖滨店已扫码' },
          { shot: '05-会员码-门店已扫码', caption: '门店扫到会员码：码停止更新，提示门店正在确认金额' },
          { run: () => data.staffConsumes(payerCode, 3650) },
          { wait: 2600 },
          { expectText: '消费成功' },
          { expectText: '36.50' },
        ],
      },
      {
        name: '07-明细',
        caption: '使用明细：按天分组，加绿减红，记错撤销的标「已撤销」',
        route: 'pages/ledger/ledger',
        storage: signedIn,
        steps: [{ expectText: '消费撤销' }, { expectText: '已撤销' }],
      },
      {
        name: '08-明细详情-撤销',
        caption: '撤销记录：白话说明，可查看原记录',
        route: 'pages/ledger/ledger',
        storage: signedIn,
        steps: [{ tap: '.ledger-row', nth: 2 }, { expectText: '已退回您的余额' }],
      },
      {
        name: '09-门店-未定位',
        caption: '可用门店（没开定位）：不显示距离，不排序',
        route: 'pages/index/index',
        storage: signedIn,
        steps: [{ tap: '.entry' }, { expectText: '开启定位' }],
      },
      {
        name: '10-门店-已定位',
        caption: '可用门店（同意定位后）：显示距离，近的在前',
        route: 'pages/index/index',
        storage: signedIn,
        authSetting: { 'scope.userLocation': true },
        location: HERE,
        steps: [{ tap: '.entry' }, { expectText: '距您' }],
      },
      {
        name: '11-导航',
        caption: '点「导航」：打开微信地图，可再选腾讯 / 高德 / 百度导航',
        route: 'pages/index/index',
        storage: signedIn,
        authSetting: { 'scope.userLocation': true },
        location: HERE,
        steps: [{ tap: '.entry' }, { tap: '.store-nav' }, { tap: '.mp-map-go' }],
      },
      {
        name: '12-电话',
        caption: '点「电话」：直接拨打门店电话',
        route: 'pages/index/index',
        storage: signedIn,
        steps: [{ tap: '.entry' }, { tap: '.store-call' }, { expectText: '0571-88880001' }],
      },
      {
        name: '13-门店-空',
        caption: '一家门店都没有时：灰字提示',
        route: 'pages/index/index',
        storage: signedIn,
        before: data.hideStores,
        after: data.showStores,
        steps: [{ expectText: '可用门店 · 0家' }, { tap: '.entry' }, { expectText: '暂无可用门店，请联系商家' }],
      },
      {
        name: '14-我的',
        caption: '我的：自己的资料、明细、会员权益、权益单、门店和退出',
        route: 'pages/mine/mine',
        storage: signedIn,
        steps: [{ expectText: MEMBER_NAME }, { expectText: '我的权益单' }],
      },
      {
        name: '15-首页-先引导签署',
        caption: '有没签的权益单：进首页先打开签署页（每份每天一次），写明会员权益金额签完才充值，标「测试签署」',
        route: 'pages/index/index',
        storage: signer,
        steps: [{ expectText: '我已阅读以上权益内容' }, { expectText: '测试签署' }],
      },
      {
        name: '16-首页-待签提醒',
        caption: '从签署页返回首页：顶部一直提醒「待签署」，点一下就去签',
        route: 'pages/index/index',
        storage: { ...signer, sign_guided: { id: data.signerFlowId, day: beijingDay() } },
        steps: [{ expectText: '您有一份权益单待签署' }],
      },
      {
        name: '17-签署-电子签页面',
        caption: '勾选「我已阅读」再点「去签署」：打开电子签平台的签署页（预览里只画占位）',
        route: `pages/sign/sign?id=${data.signerFlowId}`,
        storage: signer,
        steps: [
          { tap: '.agree' },
          { tap: '.sign-bar .btn-primary' },
          { waitFor: '.wx-web-view' },
          { shot: '17-签署-电子签页面', caption: '勾选「我已阅读」再点「去签署」：打开电子签平台的签署页（预览里只画占位）' },
          { run: data.signerSigns },
          { tap: '.nb-back' },
          { wait: 300 },
          { expectText: '签署完成' },
          { shot: '18-签署完成', caption: '签完返回：自动核对结果，显示「签署完成」和已充值的金额，可回首页或查看合同' },
          { tap: '.success-pdf' },
          { wait: 200 },
          { tap: '.success .btn-primary' },
          { wait: 300 },
          { expectText: '已签署' },
          { expectText: '500.00' },
        ],
        name: '19-签完回首页',
        caption: '回到首页：提醒条消失，余额已到账，会员权益标「已签署」',
      },
      {
        name: '20-会员权益',
        caption: '会员权益：每个方案的内容和规则；签过的标「已签署」，没办的提示到店咨询',
        route: 'pages/benefits/benefits',
        storage: signedIn,
        fullPage: true,
        steps: [{ expectText: '如需办理，请到门店咨询' }],
      },
      {
        name: '21-我的权益单',
        caption: '我的权益单：全部权益单和状态，测试环境的标「测试签署」',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        steps: [{ expectText: '已签署' }, { expectText: '已撤销' }],
      },
      {
        name: '22-权益单-已签署',
        caption: '已签署的权益单：签署时间、权益内容和规则，可查看合同',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        fullPage: true,
        steps: [{ tap: '.flow-row:has-text("已签署")' }, { expectText: '查看合同' }],
      },
      {
        name: '23-权益单-已撤销',
        caption: '门店撤销的权益单：白话说明不需要再签',
        route: 'pages/sign-list/sign-list',
        storage: signedIn,
        steps: [{ tap: '.flow-row:has-text("已撤销")' }, { expectText: '不需要再签' }],
      },
    ],
  };
}
