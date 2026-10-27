// 按场景脚本给小程序页面截图。
//
//   node tools/mp-preview/shoot.mjs <场景脚本.mjs> [--out 输出目录]
//
// 场景脚本默认导出一个对象，或返回对象的（异步）函数：
//   {
//     app: '../',                       // 小程序目录，相对场景脚本
//     out: '/tmp/shots',                // 可被 --out 覆盖
//     sheet: { title: '会员小程序', columns: 3 },  // 可选：把所有截图拼成一张总览 overview.png
//     shots: [{
//       name: '01-首页',                 // 文件名
//       caption: '首页：余额与可用门店',   // 总览图里的说明
//       route: 'pages/index/index',      // 打开哪一页
//       storage: { token: '...' },       // 预置本地存储（wx.setStorageSync 的值）
//       authSetting: {},                 // 预置授权，比如 { 'scope.userLocation': true }
//       location: { latitude, longitude } | 'deny',  // wx.getLocation 返回的位置
//       phoneDeny: false,                // 手机号授权按钮是否模拟“拒绝”
//       scanResult: '...' | async () => '...',  // wx.scanCode 扫到的内容；不给就当取消了扫码
//       fullPage: false,                 // 截整页（按内容高度）
//       before: async () => {},          // 可选：打开页面前在 Node 里做的准备（比如调接口改数据）
//       after: async () => {},           // 可选：截完以后恢复
//       steps: [{ tap: '.btn' }, { wait: 300 }, { scroll: 400 }, { fill: ['.input', '文字'] },
//               { pullDown: true }, { expectText: '余额' }, { shot: '02-弹窗', caption: '...' },
//               { run: async () => {} }],   // run：在 Node 里执行，比如让本机假服务改状态
//     }],
//   }

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from './server.mjs';

// 用 require 找 playwright，这样全局安装（NODE_PATH）的也能用。
const { chromium } = createRequire(import.meta.url)('playwright');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const scenarioPath = process.argv[2] && resolve(process.argv[2]);
if (!scenarioPath) {
  console.error('用法：node tools/mp-preview/shoot.mjs <场景脚本.mjs> [--out 输出目录]');
  process.exit(1);
}

const loaded = (await import(pathToFileURL(scenarioPath).href)).default;
const scenario = typeof loaded === 'function' ? await loaded() : loaded;
const appDir = resolve(dirname(scenarioPath), scenario.app ?? '.');
const outDir = resolve(argValue('--out') ?? scenario.out ?? join(tmpdir(), 'mp-preview'));
mkdirSync(outDir, { recursive: true });

const server = await startServer({ appDir });
const browser = await chromium.launch();
const taken = [];
let failed = false;

async function idle(page) {
  await page.evaluate(() => window.__mp.idle());
}

async function capture(page, name, caption, fullPage) {
  await idle(page);
  const path = join(outDir, `${name}.png`);
  if (fullPage) {
    await page.evaluate(() => window.__mp.expand(true));
    await page.locator('#phone').screenshot({ path });
    await page.evaluate(() => window.__mp.expand(false));
  } else {
    await page.locator('#phone').screenshot({ path });
  }
  taken.push({ name, caption: caption ?? name, path });
  console.log(`  ✓ ${path}`);
}

async function runStep(page, step) {
  if (step.tap) {
    await page.locator(step.tap).nth(step.nth ?? 0).click();
  } else if (step.fill) {
    await page.locator(step.fill[0]).first().fill(step.fill[1]);
  } else if (step.wait) {
    await page.waitForTimeout(step.wait);
  } else if (step.waitFor) {
    await page.locator(step.waitFor).first().waitFor();
  } else if (step.scroll !== undefined) {
    await page.evaluate((top) => window.__mp.scrollTo(top), step.scroll);
  } else if (step.pullDown) {
    await page.evaluate(() => window.__mp.pullDown());
  } else if (step.eval) {
    await page.evaluate(step.eval);
  } else if (step.run) {
    // 在 Node 里跑，比如让本机假服务把数据改成下一步要的样子。
    await step.run();
  } else if (step.expectText) {
    const text = await page.locator('#phone').innerText();
    if (!text.includes(step.expectText)) throw new Error(`页面上没有找到「${step.expectText}」`);
  } else if (step.shot) {
    await capture(page, step.shot, step.caption, step.fullPage);
    return;
  }
  await page.waitForTimeout(step.settle ?? 120);
  await idle(page);
}

for (const shot of scenario.shots) {
  console.log(`· ${shot.name}`);
  if (shot.before) await shot.before();
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await context.addInitScript((config) => {
    window.__MP_PREVIEW__ = config;
  }, {
    route: shot.route ?? null,
    storage: shot.storage ?? {},
    authSetting: shot.authSetting ?? {},
    location: shot.location ?? null,
    phoneDeny: shot.phoneDeny ?? false,
    envVersion: shot.envVersion ?? 'develop',
    scanResult: typeof shot.scanResult === 'function' ? await shot.scanResult() : (shot.scanResult ?? null),
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  try {
    await page.goto(`${server.url}/`);
    await page.evaluate(() => window.__mp.ready);
    await page.waitForTimeout(150);
    await idle(page);
    for (const step of shot.steps ?? []) await runStep(page, step);
    if (shot.capture !== false) await capture(page, shot.name, shot.caption, shot.fullPage);
    const errors = await page.evaluate(() => window.__mp.errors);
    if (errors.length || consoleErrors.length) {
      failed = true;
      console.error(`  ✗ 页面报错：\n    ${[...errors, ...consoleErrors].join('\n    ')}`);
    }
  } catch (error) {
    failed = true;
    console.error(`  ✗ ${error.message}`);
    await page.locator('#phone').screenshot({ path: join(outDir, `${shot.name}-失败.png`) }).catch(() => {});
  } finally {
    await context.close();
    if (shot.after) await shot.after();
  }
}

if (scenario.sheet && taken.length) {
  const columns = scenario.sheet.columns ?? 3;
  const cards = taken
    .map(
      (item) => `<figure><img src="data:image/png;base64,${readFileSync(item.path).toString('base64')}"><figcaption>${item.caption
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</figcaption></figure>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:32px;background:#f1f5f9;font-family:'PingFang SC','WenQuanYi Zen Hei',sans-serif;color:#0f172a}
    h1{margin:0 0 24px;font-size:28px}
    .grid{display:grid;grid-template-columns:repeat(${columns},375px);gap:28px}
    figure{margin:0}
    img{width:375px;display:block;border-radius:24px;box-shadow:0 6px 24px rgba(15,23,42,.12)}
    figcaption{margin-top:12px;font-size:16px;line-height:1.5;color:#334155}
  </style><h1>${(scenario.sheet.title ?? '').replace(/</g, '&lt;')}</h1><div class="grid">${cards}</div>`;
  const sheetFile = join(outDir, 'overview.html');
  writeFileSync(sheetFile, html);
  const page = await browser.newPage({ viewport: { width: 64 + columns * 375 + (columns - 1) * 28, height: 800 } });
  await page.goto(pathToFileURL(sheetFile).href);
  await page.screenshot({ path: join(outDir, 'overview.png'), fullPage: true });
  await page.close();
  console.log(`总览：${join(outDir, 'overview.png')}`);
}

await browser.close();
await server.close();
if (failed) {
  console.error('有页面截图失败或报错，见上面的输出。');
  process.exit(1);
}
