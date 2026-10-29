// 员工小程序截图场景。先在本机准备演示数据，再按店员的实际办理顺序走一遍并截图。
//
//   pnpm --filter member-mp exec tsx preview/fake-esign.mjs   # 本机假电子签平台（3901，控制口 3902）
//   WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api
//   node tools/mp-preview/shoot.mjs apps/staff-mp/preview/scenario.mjs --out /tmp/staff-shots
//
// 只连本机接口（API_BASE，默认 http://localhost:3000），会往本机数据库写演示门店、员工、会员、权益单和流水。
// 演示用的超级管理员是 prisma/seed.ts 建的 13800000000。不要对着任何正式环境跑。
// 消费都按真机的顺序走：会员在会员小程序出示会员码 → 店员扫码 → 带着会员码扣款。截图里「扫到」的码也是这样现拿的。
// 开单按真机的顺序走：输手机号 → 填会员权益金额 → 生成合同 → 顾客签完（让假电子签平台标成签好）→ 自动充值、弹会员小程序码。

import { randomUUID } from 'node:crypto';

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

/** 与 utils/session.ts 的 saveLogin 存的结构一致，直接预置进本地缓存，省掉每张图都点一次登录。 */
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

function move(token, memberId, kind, storeId, yuan, remark, payCode) {
  return call('POST', `/wallets/${memberId}/${kind}`, {
    token,
    body: {
      storeId,
      amountCent: Math.round(yuan * 100),
      requestId: randomUUID(),
      ...(remark ? { remark } : {}),
      ...(payCode ? { payCode } : {}),
    },
  });
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

/** 权益方案和权益单模板：按名称找，没有就建（只有超级管理员能建）。 */
async function ensureTemplate(admin) {
  const plans = (await call('GET', '/benefit-plans?pageSize=100', { token: admin })).items;
  const plan =
    plans.find((item) => item.title === PLAN.title) ?? (await call('POST', '/benefit-plans', { token: admin, body: PLAN }));
  const templates = (await call('GET', '/contract-templates?pageSize=100', { token: admin })).items;
  return (
    templates.find((item) => item.name === TEMPLATE_NAME) ??
    (await call('POST', '/contract-templates', {
      token: admin,
      body: { esignTemplateId: ESIGN_TEMPLATE_ID, name: TEMPLATE_NAME, benefitPlanId: plan.id },
    }))
  );
}

/** 店员扫顾客的会员码，再带着这张码扣款。返回记账结果和用掉的码。 */
async function consume(token, member, storeId, yuan, remark) {
  const code = await showCode(member.phone);
  await call('POST', '/pay-codes/scan', { token, body: { code, storeId } });
  return { ...(await move(token, member.id, 'consume', storeId, yuan, remark, code)), code };
}

async function setup() {
  const health = await call('GET', '/health');
  if (health.esignProductionEnabled) {
    throw new Error('本机接口打开了正式签署开关，截图只用测试环境，请关掉 ESIGN_PRODUCTION_ENABLED');
  }
  const admin = (await staffLogin(SUPER_ADMIN)).login.accessToken;
  const template = await ensureTemplate(admin);

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
    await consume(token, { ...wang.member, ...MEMBERS.wang }, binjiang, 168, '洗护套餐');
    await consume(token, { ...wang.member, ...MEMBERS.wang }, binjiang, 45.5);
  }
  const zhang = await ensureMember(token, xihu, MEMBERS.zhang);
  if (zhang.fresh) {
    await move(token, zhang.member.id, 'recharge', xihu, 500, '转账');
    await consume(token, { ...zhang.member, ...MEMBERS.zhang }, binjiang, 120);
  }
  const liu = await ensureMember(token, binjiang, MEMBERS.liu);
  if (liu.fresh) {
    await move(token, liu.member.id, 'recharge', binjiang, 2000, '现金');
  }
  // 张先生有一份还没签的权益单：店员在会员页能接着打开。
  const zhangPending = await call('GET', `/sign-flows?memberId=${zhang.member.id}&status=PENDING&pageSize=1`, { token });
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
  const mistake = await consume(token, { ...liu.member, ...MEMBERS.liu }, binjiang, 388, '本来是 38 元，多按了一个 8');

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

  return {
    binjiang,
    wangBalance,
    clerk,
    manager,
    mistakeId: mistake.entry.id,
    /** 已经扣过款的会员码：顾客拿截图再来扫，应该被拦下。 */
    usedCode: mistake.code,
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
  const asClerk = { 'staff.session': sessionFor(demo.clerk, demo.binjiang), 'staff.recentMembers': demo.recent };
  const asManager = { 'staff.session': sessionFor(demo.manager, demo.binjiang) };
  const wangShowsCode = () => showCode(MEMBERS.wang.phone);

  return {
    app: '..',
    sheet: { title: '员工小程序（商家工作台）', columns: 4 },
    shots: [
      {
        name: '01-登录',
        caption: '1. 店员用微信手机号一键登录，没开通的手机号进不来',
        route: 'pages/login/login',
      },
      {
        name: '02-工作台',
        caption: '2. 工作台：最上面是「扫码消费」，下面查余额、开单、最近办理',
        route: 'pages/login/login',
        storage: { 'dev.mockPhone': CLERK.phone, 'staff.recentMembers': demo.recent },
        steps: [{ tap: '.btn-wechat' }, { wait: 300 }, { expectText: '扫码消费' }, { expectText: '查会员余额' }, { expectText: '滨江店' }],
      },
      {
        name: '03-会员余额',
        caption: '3. 查到会员：能看余额、能充值；消费按钮是「扫码消费」，不扫顾客的会员码扣不了款',
        route: 'pages/index/index',
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
        name: '04-扫码后填金额',
        caption: '4. 点「扫码消费」用手机扫顾客的会员码，扫到才进入填金额，马上看到扣款后余额',
        route: 'pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCode,
        steps: [
          { tap: '.scan-card' },
          { wait: 400 },
          { expectText: '已扫码' },
          { fill: ['.amount-input', '58'] },
          { fill: ['.remark input', '剪发'] },
          { expectText: `记账后余额 ${yuan(demo.wangBalance - 5800)} 元` },
          { shot: '04-扫码后填金额', caption: '4. 点「扫码消费」用手机扫顾客的会员码，扫到才进入填金额，马上看到扣款后余额' },
          { tap: '.page > .btn-primary' },
          { expectText: '确认消费' },
          { shot: '05-二次确认', caption: '5. 提交前再确认一次：给谁、多少钱、记完剩多少' },
          { tap: '.mp-modal-confirm' },
          { wait: 400 },
          { expectText: '消费成功' },
          { shot: '06-消费成功', caption: '6. 扣款成功：显示扣了多少、现在余额多少；这张会员码就作废了' },
        ],
        capture: false,
      },
      {
        name: '07-码已用过',
        caption: '7. 拿用过的会员码（比如截图）再扫：直接拦下，请顾客刷新会员码',
        route: 'pages/index/index',
        storage: asClerk,
        scanResult: demo.usedCode,
        steps: [{ tap: '.scan-card' }, { wait: 400 }, { expectText: '这张会员码已经用过了' }],
      },
      {
        name: '08-余额不足',
        caption: '8. 余额不够时当场拦住，不会扣成负数',
        route: 'pages/index/index',
        storage: asClerk,
        scanResult: wangShowsCode,
        steps: [{ tap: '.scan-card' }, { wait: 400 }, { fill: ['.amount-input', '5000'] }, { expectText: '余额不足' }],
      },
      {
        name: '09-查无此卡',
        caption: '9. 查不到卡：直接为这个手机号开单',
        route: 'pages/index/index',
        storage: asClerk,
        steps: [
          { fill: ['.search-input', demo.newPhone] },
          { tap: '.search-btn' },
          { wait: 300 },
          { expectText: '没有找到' },
          { shot: '09-查无此卡', caption: '9. 查不到卡：直接为这个手机号开单' },
          { tap: '.result .btn-plain' },
          { wait: 300 },
          { fill: ['.field:nth-child(2) input', '赵女士'] },
          { expectText: '开单门店' },
          { shot: '10-开单-输手机号', caption: '10. 开单第 1 步：手机号已带好，称呼选填，点「下一步」直接填权益' },
          { tap: '.page > .btn-primary' },
          { wait: 400 },
          { expectText: '会员权益金额' },
          { expectText: '全场护理 9 折' },
          { fill: ['.amount-input', '1000'] },
          { expectText: '顾客签完合同后，1,000.00 元自动充值到会员余额' },
          { shot: '11-开单-填权益', caption: '11. 第 2 步：权益第一项填「会员权益金额」，下面是这份权益单的其他权益' },
          { tap: '.page > .btn-primary' },
          { expectText: '顾客签完合同后才充值到账' },
          { shot: '12-生成合同确认', caption: '12. 生成合同前再确认一次：给谁、哪份权益单、多少钱，签完才到账' },
          { tap: '.mp-modal-confirm' },
          { wait: 800 },
          { expectText: '请顾客用微信扫码签署合同' },
          { shot: '13-请顾客扫码签', caption: '13. 第 3 步：弹出签署二维码，顾客用自己的微信扫码签合同；这时余额还没变' },
          { run: () => completeSigning(demo.newPhone) },
          { wait: 5000 },
          { expectText: '请顾客扫码登录会员小程序' },
          { shot: '14-签完弹小程序码', caption: '14. 顾客一签完，自动充值到账，并弹出会员小程序码让顾客扫码登录（本机是演示码）' },
          { tap: '.code-sheet .btn-primary' },
          { wait: 300 },
          { expectText: '合同已签，已充值到账' },
          { expectText: '1,000.00 元' },
          { shot: '15-到账', caption: '15. 第 4 步：显示充了多少、现在余额多少；码关了还能再打开' },
        ],
        capture: false,
      },
      {
        name: '16-会员页待签署',
        caption: '16. 顾客当时没签也没关系：会员页能看到没签完的权益单，点「接着签」回到签署码',
        route: `pages/member/member?id=${demo.zhangId}`,
        storage: asClerk,
        steps: [{ wait: 400 }, { expectText: '待签署的权益单' }, { expectText: '会员权益金额 500.00 元' }],
      },
      {
        name: '17-本店流水',
        caption: '17. 本店流水：按天分组，可按时间和类型筛选',
        route: 'pages/ledger/ledger',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '今天共' }],
      },
      {
        name: '18-店员看详情',
        caption: '18. 店员看流水详情；记错了账要找店长冲正',
        route: `pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '请联系店长冲正' }],
      },
      {
        name: '19-店长冲正',
        caption: '19. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉）',
        route: `pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asManager,
        steps: [
          { wait: 300 },
          { expectText: '冲正这笔' },
          { shot: '19-店长冲正', caption: '19. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉）' },
          { tap: '.btn-danger' },
          { fill: ['.mp-modal textarea', '多按了一个 8，实际消费 38 元'] },
          { shot: '20-填写原因', caption: '20. 冲正必须写原因' },
          { tap: '.mp-modal-confirm' },
          { wait: 2000 },
          { expectText: '这笔已被冲正' },
          { shot: '21-冲正完成', caption: '21. 冲正完成：原记录保留，标上「已冲正」' },
          { tap: '.jump .row' },
          { wait: 400 },
          { expectText: '冲正 · 抵掉消费' },
          { shot: '22-冲正记录', caption: '22. 补记的冲正记录：388 元退回余额' },
        ],
        capture: false,
      },
      {
        name: '23-我的',
        caption: '23. 我的：当前门店、角色、退出登录',
        route: 'pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '李晓' }],
      },
      {
        name: '24-切换门店',
        caption: '24. 一人管多家店时切换门店，余额不受影响',
        route: 'pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { tap: '.list .row' }, { wait: 300 }, { expectText: '西湖店' }],
      },
    ],
  };
}
