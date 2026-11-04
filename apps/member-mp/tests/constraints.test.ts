import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// 硬约束的静态检查。会员和员工共用这一个小程序（2026-11-04 合并）：
// - 会员页在 pages/，工作台在 staff/。权限一律由服务端按登录判断。
// - 整个小程序没有支付。
// - 会员页上看不到员工、店员、店长这些字，不显示经办人；会员页只调会员能调的接口，记账写接口只在工作台里。
const root = join(__dirname, '..');
const SOURCE = /\.(ts|wxml|wxss|json)$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'tests', 'scripts', 'preview'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return SOURCE.test(name) && !['package.json', 'tsconfig.json', 'project.config.json'].includes(name) ? [path] : [];
  });
}

const files = sources(root).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
const memberFiles = files.filter((file) => !file.path.startsWith('staff/'));
const memberPages = files.filter((file) => file.path.startsWith('pages/'));

/** 去掉注释和 import 行，只看真正会运行、会显示的内容。 */
function code(file: { path: string; text: string }): string {
  if (file.path.endsWith('.wxml')) {
    return file.text.replace(/<!--[\s\S]*?-->/g, '');
  }
  if (!file.path.endsWith('.ts')) {
    return file.text;
  }
  return file.text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
}

test('找到了会员页、工作台和工具代码', () => {
  assert.ok(files.some((file) => file.path.startsWith('pages/')));
  assert.ok(files.some((file) => file.path.startsWith('utils/')));
  assert.ok(files.some((file) => file.path.startsWith('staff/pages/')));
  assert.ok(files.some((file) => file.path.startsWith('staff/utils/')));
});

test('没有微信支付', () => {
  for (const file of files) {
    assert.doesNotMatch(file.text, /requestPayment|requestOrderPayment|requestPluginPayment/, file.path);
  }
});

test('会员页上没有员工、店员、店长这些字，也不显示经办人', () => {
  for (const file of memberPages) {
    assert.doesNotMatch(code(file), /员工|店员|店长|operator/i, file.path);
  }
});

test('登录页对顾客不提工作台；底部的审核体验入口要后台打开才显示', () => {
  const wxml = code(files.find((file) => file.path === 'pages/login/login.wxml')!);
  assert.doesNotMatch(wxml, /工作台/);
  assert.match(wxml, /wx:if="\{\{reviewEnabled\}\}"[^>]*>[\s\S]*审核体验入口/);
});

test('会员这边只调会员能调的接口，记账写接口只在工作台里', () => {
  // 会员页和会员工具代码里出现的地址，只能是这些：登录、会员自己的数据、页面和图片路径。
  const allowed = /^\/(auth\/|members\/me\b|members\/stores\b|ledger\b|pages\/|staff\/pages\/|images\/)/;
  for (const file of memberFiles.filter((item) => item.path.endsWith('.ts'))) {
    for (const match of code(file).matchAll(/['"`](\/[^'"`$\s]*)(\$?)/g)) {
      if (match[1] === '/' && match[2] === '$') {
        continue; // `/${页面常量}`，常量本身另外检查
      }
      assert.match(match[1], allowed, `${file.path} 里的 ${match[1]}`);
    }
    assert.doesNotMatch(code(file), /\/recharge|\/consume|\/reversal|\/members\/open|\/pay-codes\/scan/, file.path);
  }
});

test('小程序自带的 tabBar 只给会员页；工作台的页面都在 staff/ 下', () => {
  const app = JSON.parse(files.find((file) => file.path === 'app.json')!.text) as {
    pages: string[];
    tabBar: { list: { pagePath: string }[] };
  };
  assert.equal(app.pages[0], 'pages/login/login');
  for (const item of app.tabBar.list) {
    assert.ok(item.pagePath.startsWith('pages/'), item.pagePath);
  }
  for (const file of files.filter((item) => item.path.startsWith('staff/pages/') && item.path.endsWith('.ts'))) {
    const route = file.path.replace(/\.ts$/, '').split('/').slice(0, -1).join('/') + '/' + file.path.split('/').pop()!.replace(/\.ts$/, '');
    assert.ok(app.pages.includes(route), `${route} 要登记在 app.json`);
  }
});

test('工作台底栏三页都有、并且把左上角「回首页」藏起来', () => {
  for (const tab of ['index', 'ledger', 'mine']) {
    const wxml = files.find((file) => file.path === `staff/pages/${tab}/${tab}.wxml`)!.text;
    const ts = files.find((file) => file.path === `staff/pages/${tab}/${tab}.ts`)!.text;
    assert.match(wxml, /class="tabbar"/, tab);
    assert.match(ts, /hideHomeButton\(\)/, tab);
  }
});
