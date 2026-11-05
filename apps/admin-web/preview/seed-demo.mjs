// 截图用的演示数据：三家门店、五个员工、五位会员和几笔流水。只连本机接口，对刚跑过 prisma:seed 的干净库用。
//
//   node apps/admin-web/preview/seed-demo.mjs
//
// 超级管理员用种子账号 13800000000，第一次会把初始密码 Init12345 改成 Admin12345。
// 消费按真机的顺序走：会员出示会员码 → 店员扫码 → 带着码和九讯云小票的订单号抵扣（最多商品金额的 10%）。
// 会员登录要本机接口开着 WECHAT_PHONE_MOCK=true；没开时拿不到会员码，这里跳过消费那几笔，其余照常。

const API = (process.env.API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
let token = '';

async function call(method, path, body, tk = token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(`${method} ${path} ${res.status} ${text}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

async function login(phone, password) {
  return call('POST', '/auth/staff/password/login', { phone, password }, '');
}

const ADMIN_PW = 'Admin12345';
try {
  token = (await login('13800000000', 'Init12345')).accessToken;
  await call('POST', '/auth/staff/password/change', { currentPassword: 'Init12345', newPassword: ADMIN_PW });
} catch {
  // 已经改过密码
}
const admin = await login('13800000000', ADMIN_PW);
token = admin.accessToken;
const flagship = admin.roles[0].storeId;

await call('PATCH', `/stores/${flagship}`, {
  name: '旗舰店',
  address: '示例市中心路 88 号一层',
  phone: '021-55550001',
  businessHours: '每天 10:00-22:00',
  lat: 31.230416,
  lng: 121.473701,
});
const stores = (await call('GET', '/stores?pageSize=100')).items;
const community =
  stores.find((s) => s.name === '社区店') ??
  (await call('POST', '/stores', {
    name: '社区店',
    address: '示例市幸福路 12 号',
    phone: '021-55550002',
    businessHours: '每天 9:00-21:00',
    lat: 31.2201,
    lng: 121.4502,
  }));
const mall =
  stores.find((s) => s.name === '万象店') ??
  (await call('POST', '/stores', {
    name: '万象店',
    address: '示例市万象城 3 楼 312',
    phone: '021-55550003',
    businessHours: '周一至周五 10:00-22:00',
  }));

const staffList = (await call('GET', '/staff?pageSize=100')).items;
async function ensureStaff(phone, name, storeId, role, finalPw) {
  if (staffList.some((s) => s.phone === phone)) {
    return;
  }
  await call('POST', '/staff', { phone, name, storeId, role, password: 'Init12345' });
  if (finalPw) {
    const s = await login(phone, 'Init12345');
    await call('POST', '/auth/staff/password/change', { currentPassword: 'Init12345', newPassword: finalPw }, s.accessToken);
  }
}
await ensureStaff('13800000001', '张店长', flagship, 'STORE_MANAGER', 'Manager123');
await ensureStaff('13800000002', '李店员', flagship, 'STAFF', 'Clerk12345');
await ensureStaff('13800000003', '王店员', community.id, 'STAFF', 'Clerk12345');
await ensureStaff('13800000004', '赵店员', community.id, 'STAFF', null); // 留给「首次登录改密」截图
await ensureStaff('13800000005', '陈店长', community.id, 'STORE_MANAGER', 'Manager123');

const clerk = (await login('13800000002', 'Clerk12345')).accessToken;
const communityClerk = (await login('13800000003', 'Clerk12345')).accessToken;
const members = [
  ['13912345678', '王女士', flagship, clerk],
  ['13698765432', '刘先生', flagship, clerk],
  ['13711112222', '周女士', community.id, communityClerk],
  ['13533334444', '孙先生', flagship, clerk],
  ['13855556666', null, community.id, communityClerk],
];
const ids = {};
for (const [phone, name, storeId, tk] of members) {
  try {
    ids[phone] = (await call('POST', '/members/open', { phone, name: name ?? undefined, storeId }, tk)).id;
  } catch {
    ids[phone] = (await call('GET', `/members?phone=${phone}`)).items[0].id;
  }
}

let skippedConsume = 0;
if ((await call('GET', '/ledger?pageSize=1')).total === 0) {
  const move = (kind, phone, storeId, amountCent, remark, tk) =>
    call('POST', `/wallets/${ids[phone]}/${kind}`, { storeId, amountCent, remark, requestId: crypto.randomUUID() }, tk);
  let orderSeq = 8000;
  /** 九讯云小票的单号：往后找第一张还没抵扣过的。 */
  const freshOrder = async (tk) => {
    for (;;) {
      const checked = await call('GET', `/orders/check?orderNo=A${orderSeq++}`, undefined, tk);
      if (!checked.redeemed) {
        return checked.orderNo;
      }
    }
  };
  const consume = async (phone, storeId, amountCent, remark, tk, { productAmountCent = amountCent * 10, typed = false } = {}) => {
    let payCode;
    try {
      const member = await call('POST', '/auth/member/wx-phone', { code: 'preview', phoneCode: 'preview', mockPhone: phone }, '');
      payCode = (await call('POST', '/members/me/pay-code', undefined, member.accessToken)).code;
    } catch (error) {
      if (error.status >= 500 || !error.status) {
        throw error;
      }
      skippedConsume += 1;
      return;
    }
    await call('POST', '/pay-codes/scan', { code: payCode, storeId }, tk);
    await call(
      'POST',
      `/wallets/${ids[phone]}/consume`,
      {
        storeId,
        amountCent,
        remark: remark || undefined,
        payCode,
        orderNo: await freshOrder(tk),
        ...(typed ? { orderNoTyped: true } : {}),
        productAmountCent,
        requestId: crypto.randomUUID(),
      },
      tk,
    );
  };
  await move('recharge', '13912345678', flagship, 100000, '现金', clerk);
  await consume('13912345678', flagship, 12800, '买手机抵扣', clerk, { productAmountCent: 299900 });
  await consume('13912345678', community.id, 6800, '买耳机抵扣', communityClerk, { productAmountCent: 69900, typed: true });
  await move('recharge', '13698765432', flagship, 50000, '刷卡', clerk);
  const wrong = await move('recharge', '13533334444', flagship, 300000, '转账', clerk);
  const manager = (await login('13800000001', 'Manager123')).accessToken;
  await call('POST', `/ledger/${wrong.entry.id}/reversal`, { remark: '金额录错，应为 3000 元', requestId: crypto.randomUUID() }, manager);
  await move('recharge', '13533334444', flagship, 300000, '转账（重新录入）', clerk);
  await consume('13533334444', flagship, 25800, '买平板抵扣', clerk, { productAmountCent: 399900 });
  await move('recharge', '13711112222', community.id, 20000, '现金', communityClerk);
  await consume('13711112222', community.id, 9900, '', communityClerk);
  await consume('13698765432', flagship, 4500, '', clerk);
}

console.log('演示数据已就绪', { flagship, community: community.id, mall: mall.id, skippedConsume });
