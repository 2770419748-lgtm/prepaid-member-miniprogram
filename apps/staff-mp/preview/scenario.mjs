// 员工小程序截图场景。先在本机准备演示数据，再按店员的实际办理顺序走一遍并截图。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api        # 本机接口，打开假手机号登录
//   node tools/mp-preview/shoot.mjs apps/staff-mp/preview/scenario.mjs --out /tmp/staff-shots
//
// 只连本机接口（API_BASE，默认 http://localhost:3000），会往本机数据库写演示门店、员工、会员和流水。
// 演示用的超级管理员是 prisma/seed.ts 建的 13800000000。不要对着任何正式环境跑。
// 消费都按真机的顺序走：会员在会员小程序出示会员码 → 店员扫码 → 带着会员码扣款。截图里「扫到」的码也是这样现拿的。

const API = process.env.API_BASE ?? 'http://localhost:3000';

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
// 用来演示「查不到 → 开卡」的手机号，取第一个还没登记过的。
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
    body: { storeId, amountCent: Math.round(yuan * 100), ...(remark ? { remark } : {}), ...(payCode ? { payCode } : {}) },
  });
}

/** 顾客在会员小程序里点「会员码」，二维码里就是这串数字。 */
async function showCode(phone) {
  const login = await call('POST', '/auth/member/wx-phone', {
    body: { code: 'preview', phoneCode: 'preview', mockPhone: phone },
  });
  return (await call('POST', '/members/me/pay-code', { token: login.accessToken })).code;
}

/** 店员扫顾客的会员码，再带着这张码扣款。返回记账结果和用掉的码。 */
async function consume(token, member, storeId, yuan, remark) {
  const code = await showCode(member.phone);
  await call('POST', '/pay-codes/scan', { token, body: { code, storeId } });
  return { ...(await move(token, member.id, 'consume', storeId, yuan, remark, code)), code };
}

async function setup() {
  const admin = (await staffLogin(SUPER_ADMIN)).login.accessToken;

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
        caption: '2. 工作台：最上面是「扫码消费」，下面查余额、新会员开卡、最近办理',
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
        caption: '9. 查不到卡：直接为这个手机号开卡',
        route: 'pages/index/index',
        storage: asClerk,
        steps: [
          { fill: ['.search-input', demo.newPhone] },
          { tap: '.search-btn' },
          { wait: 300 },
          { expectText: '没有找到' },
          { shot: '09-查无此卡', caption: '9. 查不到卡：直接为这个手机号开卡' },
          { tap: '.result .btn-plain' },
          { wait: 300 },
          { fill: ['.field:nth-child(2) input', '赵女士'] },
          { expectText: '开卡门店' },
          { shot: '10-开卡', caption: '10. 开卡：手机号已带好，称呼选填，记在当前门店' },
          { tap: '.page > .btn-primary' },
          { wait: 400 },
          { expectText: '开卡成功' },
          { shot: '11-开卡成功', caption: '11. 开卡成功，余额 0 元，可以直接去充值' },
          { tap: '.btn-primary:visible' },
          { wait: 400 },
          { fill: ['.amount-input', '1000'] },
          { expectText: '记账后余额 1,000.00 元' },
          { shot: '12-开卡后充值', caption: '12. 接着充值：只记账不收款，钱在店里线下收' },
        ],
        capture: false,
      },
      {
        name: '13-本店流水',
        caption: '13. 本店流水：按天分组，可按时间和类型筛选',
        route: 'pages/ledger/ledger',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '今天共' }],
      },
      {
        name: '14-店员看详情',
        caption: '14. 店员看流水详情；记错了账要找店长冲正',
        route: `pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '请联系店长冲正' }],
      },
      {
        name: '15-店长冲正',
        caption: '15. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉）',
        route: `pages/ledger-detail/ledger-detail?id=${demo.mistakeId}`,
        storage: asManager,
        steps: [
          { wait: 300 },
          { expectText: '冲正这笔' },
          { shot: '15-店长冲正', caption: '15. 店长打开同一笔：可以冲正（补记一笔反方向的抵掉）' },
          { tap: '.btn-danger' },
          { fill: ['.mp-modal textarea', '多按了一个 8，实际消费 38 元'] },
          { shot: '16-填写原因', caption: '16. 冲正必须写原因' },
          { tap: '.mp-modal-confirm' },
          { wait: 2000 },
          { expectText: '这笔已被冲正' },
          { shot: '17-冲正完成', caption: '17. 冲正完成：原记录保留，标上「已冲正」' },
          { tap: '.jump .row' },
          { wait: 400 },
          { expectText: '冲正 · 抵掉消费' },
          { shot: '18-冲正记录', caption: '18. 补记的冲正记录：388 元退回余额' },
        ],
        capture: false,
      },
      {
        name: '19-我的',
        caption: '19. 我的：当前门店、角色、退出登录',
        route: 'pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { expectText: '李晓' }],
      },
      {
        name: '20-切换门店',
        caption: '20. 一人管多家店时切换门店，余额不受影响',
        route: 'pages/mine/mine',
        storage: asClerk,
        steps: [{ wait: 300 }, { tap: '.list .row' }, { wait: 300 }, { expectText: '西湖店' }],
      },
    ],
  };
}
