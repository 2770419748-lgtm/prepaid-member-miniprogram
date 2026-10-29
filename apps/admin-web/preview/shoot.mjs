// 用真浏览器把商家后台走一遍并截图，连本机接口和真数据。只用于开发自查和给坤总看页面，不要部署。
//
//   node apps/admin-web/preview/shoot.mjs --out /tmp/admin-shots [--only login,firstlogin,admin,manager,esign] [--size 1280x720]
//
// --size 换浏览器窗口大小（默认 1440x900），查笔记本小屏下的排版用。
//
// 前提：干净的本机库跑过 prisma:seed 和 preview/seed-demo.mjs；接口指向假电子签平台
// （apps/member-mp/preview/fake-esign.mjs，3901，控制口 3902）；`pnpm dev:admin` 在 5173。
// 场景会开卡、充值、冲正、建权益方案和发起签署，所以对同一个库只跑一次。

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = option('--out') ?? '/tmp/admin-shots';
const ONLY = option('--only')?.split(',') ?? null;
const SIZE = /^(\d+)x(\d+)$/.exec(option('--size') ?? '');
const VIEWPORT = SIZE ? { width: Number(SIZE[1]), height: Number(SIZE[2]) } : { width: 1440, height: 900 };
const BASE = process.env.ADMIN_BASE ?? 'http://localhost:5173';
const CONTROL = process.env.FAKE_ESIGN_CONTROL ?? 'http://127.0.0.1:3902';
const TEMPLATE_ID = 'member-benefit-demo'; // 假电子签平台里登记的模板

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function newPage() {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  // 4xx/5xx 是故意走到的业务错误（输错密码、重复发起等），只记别的报错。
  page.on('console', (m) => {
    if (m.type() === 'error' && !/\b[45]\d\d\b/.test(m.text())) errors.push(`[console] ${m.text()}`);
  });
  return page;
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log('shot', name);
}

async function login(page, phone, password, wait = true) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[autocomplete=username]', phone);
  await page.fill('input[autocomplete=current-password]', password);
  await page.click('button[type=submit]');
  if (wait) await page.waitForURL('**/dashboard');
}

const modal = (page) => page.locator('.ant-modal-wrap:visible .ant-modal-content');
const run = (name) => !ONLY || ONLY.includes(name);

try {
  if (run('login')) {
    const page = await newPage();
    await page.goto(`${BASE}/login`);
    await shot(page, '01-登录页');
    await login(page, '13800000002', 'wrong-pass', false);
    await page.waitForSelector('.ant-alert');
    await shot(page, '02-密码输错提示');
    await page.context().close();
  }

  if (run('firstlogin')) {
    // 赵店员还是初始密码，第一次登录必须先改
    const page = await newPage();
    await login(page, '13800000004', 'Init12345', false);
    await page.waitForURL('**/change-password');
    await shot(page, '03-首次登录必须改密码');
    const pw = page.locator('input[type=password]');
    await pw.nth(0).fill('Init12345');
    await pw.nth(1).fill('Zhao123456');
    await pw.nth(2).fill('Zhao123456');
    await page.click('button[type=submit]');
    // 改完以后之前的登录全部作废，回到登录页用新密码重新登录。
    await page.waitForURL('**/login');
    await shot(page, '03b-改密后重新登录');
    await login(page, '13800000004', 'Zhao123456');
    await page.waitForTimeout(1200);
    await shot(page, '04-店员看到的概览和菜单');
    await page.context().close();
  }

  if (run('admin')) {
    const page = await newPage();
    await login(page, '13800000000', 'Admin12345');
    await page.waitForTimeout(1500);
    await shot(page, '05-超管概览');

    await page.goto(`${BASE}/members/open`);
    await page.fill('input[placeholder="11 位手机号"]', '13766668888');
    await page.fill('input[placeholder="会员称呼"]', '何女士');
    await page.click('button[type=submit]');
    await page.waitForSelector('.ant-modal-content');
    await shot(page, '06-开卡确认');
    await page.click('.ant-modal-footer .ant-btn-primary');
    await page.waitForSelector('.ant-result-success');
    await shot(page, '07-开卡成功');

    await page.click('text=去充值');
    await page.waitForSelector('.num');
    await page.fill('input[placeholder="0.00"]', '1000');
    await page.fill('input[placeholder="例如：现金、刷卡、转账"]', '现金');
    await page.click('button:has-text("充值")');
    await page.waitForSelector('.ant-modal-content');
    await shot(page, '08-充值确认');
    await page.click('.ant-modal-footer .ant-btn-primary');
    await page.waitForSelector('.ant-result-success');
    await shot(page, '09-充值成功');

    await page.goto(`${BASE}/billing/consume`);
    await page.waitForSelector('.ant-result');
    await shot(page, '10-后台消费改为扫码提示');

    await page.goto(`${BASE}/members`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '11-会员查询');
    await page.click('text=孙先生');
    await page.waitForSelector('.ant-table-row');
    await shot(page, '12-会员详情和流水');

    await page.goto(`${BASE}/ledger`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '13-流水查询');
    await page.locator('.ant-table-row', { hasText: '何女士' }).first().locator('button:has-text("冲正")').click();
    await page.waitForSelector('.ant-modal-content');
    await page.fill('textarea', '金额录错，应为 800 元');
    await shot(page, '14-冲正确认');
    await page.click('.ant-modal-footer .ant-btn-dangerous');
    await page.waitForTimeout(1200);
    await page.locator('.ant-table-row', { hasText: '何女士' }).last().locator('button:has-text("详情")').click();
    await page.waitForSelector('.ant-drawer-content');
    await shot(page, '15-冲正后的流水详情');
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/stores`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '16-门店管理');
    await page.locator('.ant-table-row', { hasText: '万象店' }).locator('button:has-text("编辑")').click();
    await page.waitForSelector('.ant-modal-content');
    await shot(page, '17-编辑门店');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/staff`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '18-员工管理');
    await page.click('button:has-text("开通员工账号")');
    await page.waitForSelector('.ant-modal-content');
    await shot(page, '19-开通员工账号');
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/reconciliation`);
    await page.waitForSelector('.ant-table-row');
    await page.click('button:has-text("开始核对")');
    await page.waitForSelector('.check');
    await shot(page, '20-当日对账', true);
    await page.goto(`${BASE}/audit-logs`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '21-操作记录');
    await page.context().close();
  }

  if (run('manager')) {
    const page = await newPage();
    await login(page, '13800000001', 'Manager123');
    await page.waitForTimeout(1200);
    await shot(page, '22-店长概览');
    await page.goto(`${BASE}/staff`);
    await page.waitForSelector('.ant-table-row');
    await shot(page, '23-店长的员工管理');
    await page.context().close();
  }

  if (run('esign')) {
    // 超管：建权益方案、绑模板（先故意填错编号）
    const admin = await newPage();
    await login(admin, '13800000000', 'Admin12345');
    await admin.goto(`${BASE}/benefits/templates`);
    await admin.waitForTimeout(800);
    await admin.click('button:has-text("新建权益方案")');
    const plan = modal(admin);
    await plan.locator('input[placeholder="例如：年度储值会员权益"]').fill('年度储值会员权益');
    await plan.locator('input[placeholder="会员首页显示的摘要"]').fill('储值后全公司门店通用');
    const items = ['全场护理 9 折', '会员专属预约通道', '每月一次免费皮肤检测'];
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await plan.locator('button:has-text("添加一条权益")').click();
      await plan.locator('input[placeholder="权益名称"]').nth(i).fill(items[i]);
    }
    await plan.locator('input[placeholder="细则（可不填）"]').nth(0).fill('限本人使用，不与其他优惠同享');
    await plan.locator('textarea').fill('储值终身有效，用完为止；全公司门店通用。');
    await shot(admin, '24-新建权益方案');
    await plan.locator('.ant-modal-footer .ant-btn-primary').click();
    await admin.waitForSelector('.ant-table-row:has-text("年度储值会员权益")');
    await shot(admin, '25-权益方案列表');

    await admin.click('.ant-tabs-tab:has-text("合同模板")');
    await admin.click('button:has-text("绑定合同模板")');
    const tpl = modal(admin);
    await tpl.locator('input[placeholder="例如：储值会员权益单"]').fill('储值会员权益单');
    await tpl.locator('input.mono').fill('not-in-sandbox');
    await tpl.locator('.ant-select').click();
    await admin.click('.ant-select-item-option:has-text("年度储值会员权益")');
    await tpl.locator('.ant-modal-footer .ant-btn-primary').click();
    await tpl.locator('.ant-alert-error').waitFor();
    await shot(admin, '26-模板编号填错');
    await tpl.locator('input.mono').fill(TEMPLATE_ID);
    await tpl.locator('.ant-modal-footer .ant-btn-primary').click();
    await admin.waitForSelector(`.ant-table-row:has-text("${TEMPLATE_ID}")`);
    await shot(admin, '27-合同模板绑定成功');

    // 从会员详情发起，弹出签署码
    await admin.goto(`${BASE}/members`);
    await admin.fill('input[placeholder*="手机号"]', '13912345678');
    await admin.keyboard.press('Enter');
    await admin.waitForTimeout(800);
    await admin.click('.ant-table-row >> text=详情');
    await admin.waitForURL('**/members/*');
    await admin.click('button:has-text("发起权益单")');
    await admin.waitForURL('**/benefits/sign-flows**');
    await modal(admin).locator('.ant-select-selection-item').first().waitFor();
    await shot(admin, '28-发起签署');
    await modal(admin).locator('button:has-text("发起签署")').click();
    await modal(admin).locator('canvas, svg').first().waitFor();
    await shot(admin, '29-签署二维码');
    await modal(admin).locator('button:has-text("完成")').click();
    await admin.waitForSelector('.ant-table-row:has-text("待签署")');

    // 同一会员再发一次会被拦
    await admin.click('.pm-toolbar button:has-text("发起签署")');
    await modal(admin).locator('input[placeholder="输入会员完整手机号"]').fill('13912345678');
    await modal(admin).locator('button:has-text("查找会员")').click();
    await modal(admin).locator('.ant-select-selection-item').first().waitFor();
    await modal(admin).locator('.ant-btn-block:has-text("发起签署")').click();
    await modal(admin).locator('.ant-alert-error').waitFor();
    await shot(admin, '30-重复发起被拦');
    await admin.keyboard.press('Escape');
    await admin.waitForTimeout(400);

    // 假电子签平台把会员的权益单标成签好了，后台点刷新
    await fetch(`${CONTROL}/complete`, { method: 'POST', body: JSON.stringify({ phone: '13912345678' }) });
    await admin.click('.ant-table-row:has-text("待签署") >> button:has-text("刷新状态")');
    await admin.waitForSelector('.ant-table-row:has-text("已签署")');
    await shot(admin, '31-会员签完刷新后');
    const [download] = await Promise.all([
      admin.waitForEvent('download'),
      admin.click('.ant-table-row:has-text("已签署") >> button:has-text("下载 PDF")'),
    ]);
    if (!(await download.path())) errors.push('[download] 合同 PDF 没下载下来');
    await admin.context().close();

    // 店长：给刘先生发起后撤销
    const manager = await newPage();
    await login(manager, '13800000001', 'Manager123');
    await manager.goto(`${BASE}/benefits/sign-flows`);
    await manager.waitForTimeout(800);
    await manager.click('.pm-toolbar button:has-text("发起签署")');
    await modal(manager).locator('input[placeholder="输入会员完整手机号"]').fill('13698765432');
    await modal(manager).locator('button:has-text("查找会员")').click();
    await modal(manager).locator('.ant-select-selection-item').first().waitFor();
    await modal(manager).locator('.ant-btn-block:has-text("发起签署")').click();
    await modal(manager).locator('button:has-text("完成")').click();
    await manager.click('.ant-table-row:has-text("刘先生") >> button:has-text("撤销")');
    await modal(manager).locator('textarea').fill('模板选错了，重新发');
    await shot(manager, '32-店长撤销确认');
    await modal(manager).locator('.ant-btn-dangerous').click();
    await manager.waitForSelector('.ant-table-row:has-text("已撤销")');
    await shot(manager, '33-撤销后');
    await manager.context().close();

    // 店员：能看列表和下载，没有撤销、没有模板配置
    const clerk = await newPage();
    await login(clerk, '13800000002', 'Clerk12345');
    await clerk.goto(`${BASE}/benefits/sign-flows`);
    await clerk.waitForSelector('.ant-table-row');
    await shot(clerk, '34-店员的签署列表');
    await clerk.context().close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  console.log(errors.length ? `页面报错：\n${errors.join('\n')}` : '页面没有报错');
  if (errors.length) process.exitCode = 1;
  await browser.close();
}
