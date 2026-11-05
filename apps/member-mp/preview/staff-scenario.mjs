// 工作台（员工用的那一半，在 staff/ 下）截图场景。先在本机准备演示数据，再按店员的实际办理顺序走一遍并截图。
// 会员和员工共用一个小程序（2026-11-04 合并）：店员在同一个登录页用微信手机号登录，认出是员工就直接进工作台。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/staff-scenario.mjs --out /tmp/staff-shots
//
// 开单默认是上传纸质协议单（坤总 2026-11-05），照片用 preview/fixtures 里画的演示样张。
// 要截电子签那一套，接口带上 SIGN_MODE=esign 和假电子签平台：
//   pnpm --filter member-mp exec tsx preview/fake-esign.mjs   # 本机假电子签平台（3901，控制口 3902）
//   SIGN_MODE=esign WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api
//
// 只连本机接口（API_BASE，默认 http://localhost:3000），会往本机数据库写演示门店、员工、会员、权益单和流水。
// 演示用的超级管理员是 prisma/seed.ts 建的 13800000000。不要对着任何正式环境跑。
// 消费都按真机的顺序走：会员在会员小程序出示会员码 → 店员扫码 → 再扫九讯云小票的订单码、填商品应付金额 → 带着会员码和单号抵扣（最多 10%）。
// 截图里「扫到」的会员码也是这样现拿的；订单号从一个起点往后找还没抵过的，同一个库重复跑也不会撞。
// 开单按真机的顺序走：输手机号 → 填会员权益金额 → 拍照上传协议单 → 上传即充值、弹小程序码。
// 电子签模式：输手机号 → 填会员权益金额 → 生成合同 → 顾客签完（让假电子签平台标成签好）→ 自动充值、弹小程序码。

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = process.env.API_BASE ?? 'http://localhost:3000';
const ESIGN_CONTROL = process.env.FAKE_ESIGN_CONTROL ?? 'http://127.0.0.1:3902';
/** 和 apps/member-mp/preview/fake-esign.mjs 里登记的演示模板一致。 */
const ESIGN_TEMPLATE_ID = 'member-benefit-demo';
const PLAN = {
  title: '储值会员权益',
  summary: '储值后全部门店通用',
  items: [
    { title: '全场护理 9 折', detail: '储值消费自动按折后价记账' },
    { title: '生日月赠护理一次', detail: '限会员本人' },
    { title: '免费停车 2 小时' },
  ],
  rules: '储值终身有效，用完为止。余额不能提现。',
};
const TEMPLATE_NAME = '储值会员权益单';
/** 演示用的协议单照片（假的，满版水印），路径相对小程序目录。 */
const AGREEMENT_PHOTOS = ['preview/fixtures/agreement-demo-1.jpg', 'preview/fixtures/agreement-demo-2.jpg'];

const SUPER_ADMIN = '13800000000';
const MANAGER = { phone: '13900000001', name: '陈店长' };
const CLERK = { phone: '13900000002', name: '李晓' };
const STORES = [
  { name: '滨江店', address: '滨江区江南大道 100 号', businessHours: '10:00-22:00' },
  { name: '西湖店', address: '西湖区文三路 200 号', businessHours: '10:00-21:30' },
];
const MEMBERS = {
  wang: { phone: '13812345678', name: '王女士' },
  zhang: { phone: '13687654321', name: '张先生' },
  liu: { phone: '13566668888', name: '刘女士' },
  appOnly: { phone: '13711112222' },
};
// 用来演示「查不到 → 开单」的手机号，取第一个还没登记过的。
const NEW_PHONES = ['13300001111', '13300002222', '13300003333', '13300004444', '13300005555'];
const DEMO_PASSWORD = 'Demo12345';

/** 与 utils/money.ts 的 formatCent 一致，用来核对页面上的金额。 */
function yuan(cent) {
  const text = (Math.floor(cent / 100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${text}.${(cent % 100).toString().padStart(2, '0')}`;
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    error.status = res.status;
    throw error;
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

/** 与 staff/utils/session.ts 的 saveLogin 存的结构一致，直接预置进本地缓存，省掉每张图都点一次登录。 */
function sessionFor({ login, access }, storeId) {
  return {
    token: login.accessToken,
    expiresAt: Date.now() + (login.expiresIn - 60) * 1000,
    staff: login.staff,
    access,
    storeId,
  };
}

async function findMember(token, phone) {
  const page = await call('GET', `/members?phone=${phone}&pageSize=1`, { token });
  return page.items[0] ?? null;
}

async function ensureMember(token, storeId, { phone, name }) {
  const existing = await findMember(token, phone);
  if (existing?.hasCard) {
    return { member: existing, fresh: false };
  }
  return { member: await call('POST', '/members/open', { token, body: { phone, name, storeId } }), fresh: true };
}

function move(token, memberId, kind, storeId, yuan, remark, extra = {}) {
  return call('POST', `/wallets/${memberId}/${kind}`, {
    token,
    body: {
      storeId,
      amountCent: Math.round(yuan * 100),
      requestId: randomUUID(),
      ...(remark ? { remark } : {}),
      ...extra,
    },
  });
}

/** 九讯云小票的单号（A + 数字）：从 start 往后找第一张还没抵扣过的。 */
async function freshOrder(token, start) {
  for (let n = start; ; n += 1) {
    const checked = await call('GET', `/orders/check?orderNo=A${n}`, { token });
    if (!checked.redeemed) {
      return checked.orderNo;
    }
  }
}

/** 顾客在会员小程序里点「会员码」，二维码里就是这串数字。 */
async function showCode(phone) {
  const login = await call('POST', '/auth/member/wx-phone', {
    body: { code: 'preview', phoneCode: 'preview', mockPhone: phone },
  });
  return (await call('POST', '/members/me/pay-code', { token: login.accessToken })).code;
}

/** 让假电子签平台把这位顾客待签的合同标成签好了（相当于顾客在手机上签完）。 */
async function completeSigning(phone) {
  const reply = await fetch(`${ESIGN_CONTROL}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  }).catch(() => null);
  if (!reply || !reply.ok) {
    throw new Error(`连不上假电子签平台 ${ESIGN_CONTROL}，请先运行 apps/member-mp/preview/fake-esign.mjs`);
  }
}

/** 权益方案：按名称找，没有就建（只有超级管理员能建）。 */
async function ensurePlan(admin) {
  const plans = (await call('GET', '/benefit-plans?pageSize=100', { token: admin })).items;
  return plans.find((item) => item.title === PLAN.title) ?? (await call('POST', '/benefit-plans', { token: admin, body: PLAN }));
}

/** 电子签模式用的权益单模板：按名称找，没有就建。 */
async function ensureTemplate(admin, plan) {
  const templates = (await call('GET', '/contract-templates?pageSize=100', { token: admin })).items;
  return (
    templates.find((item) => item.name === TEMPLATE_NAME) ??
    (await call('POST', '/contract-templates', {
      token: admin,
      body: { esignTemplateId: ESIGN_TEMPLATE_ID, name: TEMPLATE_NAME, benefitPlanId: plan.id },
    }))
  );
}

/** 店员扫顾客的会员码，再扫小票的订单码、填商品应付金额，带着码和单号抵扣。返回记账结果、用掉的码和单号。 */
async function consume(token, member, storeId, yuan, productYuan, remark) {
  const code = await showCode(member.phone);
  await call('POST', '/pay-codes/scan', { token, body: { code, storeId } });
  const orderNo = await freshOrder(token, 3000);
  const extra = { payCode: code, orderNo, productAmountCent: Math.round(productYuan * 100) };
  return { ...(await move(token, member.id, 'consume', storeId, yuan, remark, extra)), code, orderNo };
}

/** 店员拍照上传一份纸质协议单（和工作台一样：先一张张传照片，再交单充值）。 */
async function uploadPaper(token, memberId, storeId, plan, amountCent) {
  const photoIds = [];
  for (const path of AGREEMENT_PHOTOS) {
    const form = new FormData();
    form.append('file', new Blob([await readFile(new URL(`../${path}`, import.meta.url))], { type: 'image/jpeg' }), 'agreement.jpg');
    const res = await fetch(`${API}/sign-flows/photos`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) throw new Error(`上传协议单照片 → ${res.status} ${await res.text()}`);
    photoIds.push((await res.json()).id);
  }
  return call('POST', '/sign-flows/paper', {
    token,
    body: { memberId, storeId, benefitPlanId: plan.id, rechargeAmountCent: amountCent, photoIds, requestId: randomUUID() },
  });
}

async function setup() {
  const health = await call('GET', '/health');
  if (health.esignProductionEnabled) {
    throw new Error('本机接口打开了正式签署开关，截图只用测试环境，请关掉 ESIGN_PRODUCTION_ENABLED');
  }
  const admin = (await staffLogin(SUPER_ADMIN)).login.accessToken;
  const mode = (await call('GET', '/sign-flows/config', { token: admin })).mode;
  const plan = await ensurePlan(admin);
  const template = mode === 'ESIGN' ? await ensureTemplate(admin, plan) : null;

  const stores = (await call('GET', '/stores?pageSize=100', { token: admin })).items;
  const storeIds = [];
  for (const spec of STORES) {
    const found = stores.find((store) => store.name === spec.name);
    storeIds.push(found ? found.id : (await call('POST', '/stores', { token: admin, body: spec })).id);
  }
  const [binjiang, xihu] = storeIds;

  const staff = (await call('GET', '/staff?pageSize=100', { token: admin })).items;
  for (const person of [MANAGER, CLERK]) {
    if (!staff.some((item) => item.phone === person.phone)) {
      const role = person === MANAGER ? 'STORE_MANAGER' : 'STAFF';
      await call('POST', '/staff', {
        token: admin,
        body: { ...person, storeId: binjiang, role, password: DEMO_PASSWORD },
      });
    }
  }
  const clerkId = (await call('GET', '/staff?pageSize=100', { token: admin })).items.find(
    (item) => item.phone === CLERK.phone,
  ).id;
  await call('PUT', `/staff/${clerkId}/roles`, {
    token: admin,
    body: {
      roles: [
        { storeId: binjiang, role: 'STAFF' },
        { storeId: xihu, role: 'STAFF' },
      ],
    },
  });

  const clerk = await staffLogin(CLERK.phone);
  const manager = await staffLogin(MANAGER.phone);
  const token = clerk.login.accessToken;

  const wang = await ensureMember(token, binjiang, MEMBERS.wang);
  if (wang.fresh) {
    await move(token, wang.member.id, 'recharge', binjiang, 1000, '现金');
    await consume(token, { ...wang.member, ...MEMBERS.wang }, binjiang, 168, 1999, '买手机抵扣');
    await consume(token, { ...wang.member, ...MEMBERS.wang }, binjiang, 45.5, 499);
  }
  const zhang = await ensureMember(token, xihu, MEMBERS.zhang);
  if (zhang.fresh) {
    await move(token, zhang.member.id, 'recharge', xihu, 500, '转账');
    await consume(token, { ...zhang.member, ...MEMBERS.zhang }, binjiang, 120, 1299);
  }
  const liu = await ensureMember(token, binjiang, MEMBERS.liu);
  if (liu.fresh) {
    await move(token, liu.member.id, 'recharge', binjiang, 2000, '现金');
  }
  if (mode === 'PAPER') {
    // 张先生在店里签过一份纸质协议单：会员页能点开看照片。
    const zhangFlows = await call('GET', `/sign-flows?memberId=${zhang.member.id}&pageSize=20`, { token });
    if (!zhangFlows.items.some((flow) => flow.kind === 'PAPER')) {
      await uploadPaper(token, zhang.member.id, binjiang, plan, 50000);
    }
  }
  // 电子签模式：张先生有一份还没签的权益单，店员在会员页能接着打开。
  const zhangPending =
    mode === 'ESIGN'
      ? await call('GET', `/sign-flows?memberId=${zhang.member.id}&status=PENDING&pageSize=1`, { token })
      : { items: [true] };
  if (!zhangPending.items.length) {
    await call('POST', '/sign-flows', {
      token,
      body: {
        memberId: zhang.member.id,
        templateId: template.id,
        storeId: binjiang,
        rechargeAmountCent: 50000,
        requestId: randomUUID(),
      },
    });
  }
  // 每次都补一笔记错的消费，留给店长现场冲正。
  const mistake = await consume(token, { ...liu.member, ...MEMBERS.liu }, binjiang, 388, 3999, '本来是 38 元，多按了一个 8');
  // 一张已经抵过的单：店员再扫它应该被拦下。冲正那笔会放开单号，所以另抵一笔不冲正的。
  const redeemed = await consume(token, { ...zhang.member, ...MEMBERS.zhang }, xihu, 20, 999, '买耳机抵扣');

  // 在会员小程序登录过、还没开卡的人。
  await call('POST', '/auth/member/wx-phone', {
    body: { code: 'preview', phoneCode: 'preview', mockPhone: MEMBERS.appOnly.phone },
  });

  let newPhone = null;
  for (const phone of NEW_PHONES) {
    if (!(await findMember(token, phone))) {
      newPhone = phone;
      break;
    }
  }
  if (!newPhone) {
    throw new Error('演示用的新手机号都开过卡了，换一个空数据库再跑');
  }

  const wangBalance = (await call('GET', `/members/${wang.member.id}`, { token })).balanceCent;
  // 截图里店员要扫的单：抵扣那张现找，其余几张（不提交）各从不同的起点找，互不相撞。
  const orders = {
    over: await freshOrder(token, 6100),
    typed: await freshOrder(token, 6200),
    short: await freshOrder(token, 6300),
    big: await freshOrder(token, 6400),
  };

  return {
    mode,
    binjiang,
    wangBalance,
    clerk,
    manager,
    mistakeId: mistake.entry.id,
    /** 已经扣过款的会员码：顾客拿截图再来扫，应该被拦下。 */
    usedCode: mistake.code,
    /** 已经抵过的九讯云订单号。 */
    redeemedOrder: redeemed.orderNo,
    orders,
    token,
    newPhone,
    zhangId: zhang.member.id,
    recent: [
      { id: wang.member.id, phone: MEMBERS.wang.phone, name: MEMBERS.wang.name },
      { id: zhang.member.id, phone: MEMBERS.zhang.phone, name: MEMBERS.zhang.name },
    ],
  };
}

export default async function scenario() {
  const demo = await setup();
  const asClerk = {
    'staff.session': sessionFor(demo.clerk, demo.binjiang),
    'staff.recentMembers': demo.recent,
    app_mode: 'staff',
  };
  const asManager = { 'staff.session': sessionFor(demo.manager, demo.binjiang), app_mode: 'staff' };
  const wangShowsCode = () => showCode(MEMBERS.wang.phone);
  /** 先扫会员码、再扫订单码：扫码结果按先后各用一个。 */
  const wangShowsCodeThen = (order) => async () => [await showCode(MEMBERS.wang.phone), order];
  const scanBoth = [{ tap: '.scan-card' }, { wait: 400 }, { tap: '.scan-order' }, { wait: 400 }];

  // 开单第 2 步以后：纸质协议单（默认）
  const paperOrderSteps = [
    { tap: '.page > .btn-primary' },
    { wait: 400 },
    { expectText: '会员权益金额' },
    { expectText: '全场护理 9 折' },
    { fill: ['.amount-input', '1000'] },
    { expectText: '上传顾客签字的协议单后，1,000.00 元立即充值到会员余额' },
    { shot: '16-开单-填权益', caption: '16. 第 2 步：填会员权益金额，下面是这个权益方案的其他权益' },
    { tap: '.page > .btn-primary' },
    { wait: 300 },
    { expectText: '拍照上传协议单' },
    { shot: '17-开单-传协议单', caption: '17. 第 3 步：请顾客在纸质协议单上签字，店员拍照上传（最多 9 张）' },
    { tap: '.photo-add' },
    { wait: 500 },
    { shot: '18-拍好协议单', caption: '18. 拍好的照片可以点开放大、删掉重拍；这时余额还没变' },
    { tap: '.page > .btn-primary' },
    { expectText: '协议单照片 2 张' },
    { shot: '19-上传确认', caption: '19. 上传前再确认一次：给谁、哪个方案、多少钱、几张照片，上传后立即到账' },
    { tap: '.mp-modal-confirm' },
    { wait: 1500 },
    { expectText: '请顾客扫码登录小程序' },
    { shot: '20-上传即到账', caption: '20. 上传成功就充值到账，并弹出小程序码让顾客扫码登录（本机是演示码）' },
    { tap: '.code-sheet .btn-primary' },
    { wait: 300 },
    { expectText: '协议单已上传，已充值到账' },
    { expectText: '1,000.00 元' },
    { shot: '20b-到账', caption: '20b. 第 4 步：显示充了多少、现在余额多少；码关了还能再打开' },
  ];
  // 电子签开关打开时
  const esignOrderSteps = [
          { tap: '.page > .btn-primary' },
          { wait: 400 },
          { expectText: '会员权益金额' },
          { expectText: '全场护理 9 折' },
          { fill: ['.amount-input', '1000'] },
          { expectText: '顾客签完合同后，1,000.00 元自动充值到会员余额' },
          { shot: '16-开单-填权益', caption: '16. 第 2 步：权益第一项填「会员权益金额」，下面是这份权益单的其他权益' },
          { tap: '.page > .btn-primary' },
          { expectText: '顾客签完合同后才充值到账' },
          { shot: '17-生成合同确认', caption: '17. 生成合同前再确认一次：给谁、哪份权益单、多少钱，签完才到账' },
          { tap: '.mp-modal-confirm' },
          { wait: 800 },
          { expectText: '请顾客用微信扫码签署合同' },
          { shot: '18-请顾客扫码签', caption: '18. 第 3 步：弹出签署二维码，顾客用自己的微信扫码签合同；这时余额还没变' },
          { run: () => completeSigning(demo.newPhone) },
          { wait: 5000 },
          { expectText: '请顾客扫码登录小程序' },
          { shot: '19-签完弹小程序码', caption: '19. 顾客一签完，自动充值到账，并弹出小程序码让顾客扫码登录（本机是演示码）' },
          { tap: '.code-sheet .btn-primary' },
          { wait: 300 },
          { expectText: '合同已签，已充值到账' },
          { expectText: '1,000.00 元' },
          { shot: '20-到账', caption: '20. 第 4 步：显示充了多少、现在余额多少；码关了还能再打开' },
  ];

  return {
    app: '..',
    sheet: { title: '工作台（员工用，和会员页同一个小程序）', columns: 4 },
    shots: [
      {
        name: '01-登录',
        caption: '1. 和顾客同一个登录页，店员也是点「手机号快捷登录」',
        route: 'pages/login/login',
      },
      {
        name: '02-工作台',
        caption: '2. 认出是员工的手机号，直接进工作台：最上面是「扫码消费」，下面查余额、开单、最近办理',
        route: 'pages/login/login',
        storage: { dev_mock_phone: CLERK.phone, 'staff.recentMembers': demo.recent },
        steps: [{ tap: '.btn-primary' }, { wait: 400 }, { expectText: '扫码消费' }, { expectText: '查会员余额' }, { expectText: '滨江店' }],
      },
      {
        name: '03-会员余额',
        caption: '3. 查到会员：能看余额、能充值；消费按钮是「扫码消费」，不扫顾客的会员码扣不了款',
        route: 'staff/pages/index/index',
        storage: asClerk,
        steps: [
          { fill: ['.search-input', MEMBERS.wang.phone] },
          { tap: '.search-btn' },
          { wait: 300 },
          { expectText: '余额（全公司门店通用）' },
          { expectText: yuan(demo.wangBalance) },
          { expectText: '消费要先扫顾客小程序里的会员码' },
        ],
      },
      {
        name: '04-扫完会员码',
        caption: '4. 点「扫码消费」扫顾客的会员码，扫到后先扫九讯云小票上的订单码',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCode,
        steps: [{ tap: '.scan-card' }, { wait: 400 }, { expectText: '已扫码' }, { expectText: '扫订单码' }],
      },
      {
        name: '05-扫订单填金额',
        caption: '5. 扫到订单号后填商品应付金额，自动算出最多抵 10%（余额不够就抵余额），马上看到抵扣后余额',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: async () => wangShowsCodeThen(await freshOrder(demo.token, 5982))(),
        steps: [
          ...scanBoth,
          { expectText: '已扫码' },
          { fill: ['.product-input', '1299'] },
          { fill: ['.remark input', '买耳机'] },
          { expectText: '最多可抵 129.90 元（商品金额的 10%）' },
          { expectText: `抵扣后余额 ${yuan(demo.wangBalance - 12990)} 元` },
          { shot: '05-扫订单填金额', caption: '5. 扫到订单号后填商品应付金额，自动算出最多抵 10%（余额不够就抵余额），马上看到抵扣后余额' },
          { tap: '.page > .btn-primary' },
          { expectText: '确认抵扣' },
          { shot: '06-二次确认', caption: '6. 提交前再确认一次：给谁、哪张单、商品多少钱、抵多少、剩多少' },
          { tap: '.mp-modal-confirm' },
          { wait: 400 },
          { expectText: '抵扣成功' },
          { shot: '07-抵扣成功', caption: '7. 抵扣成功：显示抵了多少、余额、订单号；这张会员码作废，这张单也不能再抵' },
        ],
        capture: false,
      },
      {
        name: '08-码已用过',
        caption: '8. 拿用过的会员码（比如截图）再扫：直接拦下，请顾客刷新会员码',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: demo.usedCode,
        steps: [{ tap: '.scan-card' }, { wait: 400 }, { expectText: '这张会员码已经用过了' }],
      },
      {
        name: '09-单已抵过',
        caption: '9. 同一张小票再扫（换了会员、换了门店也一样）：说清楚哪天在哪家店抵了多少，不让再抵',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCodeThen(demo.redeemedOrder),
        steps: [...scanBoth, { expectText: '这张单已经抵扣过了' }, { expectText: '在西湖店抵了 20.00 元' }],
      },
      {
        name: '10-超过10%',
        caption: '10. 手动改的抵扣金额超过商品金额的 10%：当场拦住',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCodeThen(demo.orders.over),
        steps: [
          ...scanBoth,
          { fill: ['.product-input', '300'] },
          { fill: ['.amount-input', '58'] },
          { expectText: '这单最多只能抵 30.00 元（商品金额的 10%）' },
        ],
      },
      {
        name: '11-一单最多1000元',
        caption: '11. 一张单最多抵 1000 元：15,999 元的手机 10% 是 1,599.90 元，也只抵 1,000 元',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: async () => [await showCode(MEMBERS.liu.phone), demo.orders.big],
        steps: [
          ...scanBoth,
          { fill: ['.product-input', '15999'] },
          { expectText: '最多可抵 1,000.00 元（一张单最多抵 1,000 元）' },
          { expectText: '确认抵扣 1,000.00 元' },
        ],
      },
      {
        name: '12-手输单号',
        caption: '12. 条码扫不出来时照小票手输单号（只输数字就行），记录上会标「手输单号」方便对账',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCode,
        steps: [
          { tap: '.scan-card' },
          { wait: 400 },
          { tap: '.type-order' },
          { fill: ['.order-input', demo.orders.typed.slice(1)] },
          { tap: '.order-ok' },
          { wait: 400 },
          { expectText: '手输单号' },
          { fill: ['.product-input', '899'] },
          { expectText: '最多可抵 89.90 元' },
        ],
      },
      {
        name: '13-余额不足',
        caption: '13. 抵扣金额超过余额时当场拦住，不会扣成负数',
        route: 'staff/pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCodeThen(demo.orders.short),
        steps: [
          ...scanBoth,
          { fill: ['.product-input', '9000'] },
          { expectText: `余额只有 ${yuan(demo.wangBalance - 12990)} 元` },
          { fill: ['.amount-input', '800'] },
          { expectText: '余额不足' },
        ],
      },
      {
        name: '14-查无此卡',
        caption: '14. 查不到卡：直接为这个手机号开单',
        route: 'staff/pages/index/index',
        storage: asClerk,
        // 店员点「拍照 / 相册」时选中的照片（演示样张）。
        chooseMedia: AGREEMENT_PHOTOS,
        steps: [
          { fill: ['.search-input', demo.newPhone] },
          { tap: '.search-btn' },
          { wait: 300 },
          { expectText: '没有找到' },
          { shot: '14-查无此卡', caption: '14. 查不到卡：直接为这个手机号开单' },
          { tap: '.result .btn-plain' },
          { wait: 300 },
          { fill: ['.field:nth-child(2) input', '赵女士'] },
          { expectText: '开单门店' },
          { shot: '15-开单-输手机号', caption: '15. 开单第 1 步：手机号已带好，称呼选填，点「下一步」直接填权益' },
          ...(demo.mode === 'PAPER' ? paperOrderSteps : esignOrderSteps),
        ],
        capture: false,
      },
      demo.mode === 'PAPER'
        ? {
            name: '21-会员页协议单',
            caption: '21. 会员页能看到这位会员签过的协议单，点开看照片',
            route: `staff/pages/member/member?id=${demo.zhangId}`,
            storage: asClerk,
            steps: [
              { wait: 400 },
              { expectText: '协议单' },
              { expectText: '500.00' },
              { shot: '21-会员页协议单', caption: '21. 会员页能看到这位会员签过的协议单，点「看照片」' },
              { tap: '.list .row:has-text("看照片")' },
              { wait: 800 },
              { shot: '21b-看协议单照片', caption: '21b. 点开就是顾客签字的协议单照片（截图里是演示样张）' },
            ],
            capture: false,
          }
        : {
            name: '21-会员页待签署',
            caption: '21. 顾客当时没签也没关系：会员页能看到没签完的权益单，点「接着签」回到签署码',
            route: `staff/pages/member/member?id=${demo.zhangId}`,
            storage: asClerk,
            steps: [{ wait: 400 }, { expectText: '待签署的权益单' }, { expectText: '会员权益金额 500.00 元' }],
          },
      {
        name: '22-本店流水',
        caption: '22. 本店流水：按天分组，可按时间和类型筛选，每笔抵扣带单号',
        route: 'staff/pages/ledger/ledger',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '今天共' }],
      },
      {
        name: '23-店员看详情',
        caption: '23. 店员看流水详情：带着九讯云订单号和商品金额；记错了账要找店长冲正',
        route: `staff/pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '请联系店长冲正' }, { expectText: '九讯云订单' }, { expectText: '3,999.00' }],
      },
      {
        name: '24-店长冲正',
        caption: '24. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉），冲正后这张单可以重新抵',
        route: `staff/pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asManager,
        steps: [
          { wait: 300 },
          { expectText: '冲正这笔' },
          { expectText: '冲正后这张九讯云订单可以重新抵扣' },
          { shot: '24-店长冲正', caption: '24. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉），冲正后这张单可以重新抵' },
          { tap: '.btn-danger' },
          { fill: ['.mp-modal textarea', '多按了一个 8，实际消费 38 元'] },
          { shot: '25-填写原因', caption: '25. 冲正必须写原因' },
          { tap: '.mp-modal-confirm' },
          { wait: 2000 },
          { expectText: '这笔已被冲正' },
          { shot: '26-冲正完成', caption: '26. 冲正完成：原记录保留，标上「已冲正」' },
          { tap: '.jump .row' },
          { wait: 400 },
          { expectText: '冲正 · 抵掉消费' },
          { shot: '27-冲正记录', caption: '27. 补记的冲正记录：388 元退回余额' },
        ],
        capture: false,
      },
      {
        name: '28-我的',
        caption: '28. 我的：当前门店、角色、切到我的会员卡、退出登录',
        route: 'staff/pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '李晓' }],
      },
      {
        name: '29-切换门店',
        caption: '29. 一人管多家店时切换门店，余额不受影响',
        route: 'staff/pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { tap: '.list .row' }, { wait: 300 }, { expectText: '西湖店' }],
      },
    ],
  };
}
