// 微信审核体验入口（上线清单 D）的截图场景：后台打开入口后，小程序登录页底部出现「审核体验入口」，
// 审核员用账号密码登进演示公司，工作台和会员页都是演示数据；后台关掉后入口消失。
//
//   WECHAT_PHONE_MOCK=true pnpm dev:api
//   node tools/mp-preview/shoot.mjs apps/member-mp/preview/review-demo-scenario.mjs --out /tmp/review-shots
//
// 只连本机接口（API_BASE，默认 http://localhost:3000）。会用 prisma/seed.ts 建的超级管理员 13800000000
// 打开审核入口（第一次打开时建演示公司），最后把入口关掉。不要对着任何正式环境跑。

const API = process.env.API_BASE ?? 'http://localhost:3000';
const SUPER_ADMIN = '13800000000';

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

export default async function scenario() {
  const admin = (
    await call('POST', '/auth/staff/wx-phone', { body: { code: 'preview', phoneCode: 'preview', mockPhone: SUPER_ADMIN } })
  ).accessToken;
  const opened = await call('POST', '/review-demo/open', { token: admin });

  return {
    app: '..',
    sheet: { title: '微信审核体验入口', columns: 4 },
    shots: [
      {
        name: '01-登录页出现审核入口',
        caption: '1. 后台打开以后，登录页最下面多一行「审核体验入口」，点开填账号密码',
        route: 'pages/login/login',
        steps: [
          { wait: 500 },
          { tap: '.review-link' },
          { fill: ['.review-input >> nth=0', opened.account] },
          { fill: ['.review-input >> nth=1', opened.password] },
          { shot: '01-登录页出现审核入口', caption: '1. 后台打开以后，登录页最下面多一行「审核体验入口」，点开填账号密码' },
          { tap: '.review-btn' },
          { wait: 800 },
          { expectText: '扫码消费' },
          { expectText: '演示一店' },
          { shot: '02-审核员进工作台', caption: '2. 登进去是演示公司的工作台：演示门店、演示流水，碰不到真实数据' },
          { tap: '.mycard' },
          { wait: 800 },
          { expectText: '可用余额' },
          { expectText: '333.00' },
          { shot: '03-审核员的会员卡', caption: '3. 点「切到我的会员卡」看会员页：余额、流水、会员码都是演示数据' },
        ],
        capture: false,
      },
      {
        name: '04-关掉后入口消失',
        caption: '4. 后台点「关闭入口」（或 7 天到期）以后，登录页就没有审核入口了，已登录的审核员也会被退出',
        route: 'pages/login/login',
        before: async () => {
          await call('POST', '/review-demo/close', { token: admin });
        },
        steps: [{ wait: 500 }, { expectText: '手机号快捷登录' }],
      },
    ],
  };
}
