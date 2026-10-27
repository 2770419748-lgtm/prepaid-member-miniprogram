import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// 硬约束的静态检查：会员端没有支付、没有员工入口和员工字段。
const root = join(__dirname, '..');
const SOURCE = /\.(ts|wxml|wxss|json)$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'tests', 'scripts', 'preview'].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return SOURCE.test(name) && name !== 'package.json' ? [path] : [];
  });
}

const files = sources(root).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));

test('找到了页面和工具代码', () => {
  assert.ok(files.some((file) => file.path.startsWith('pages/')));
  assert.ok(files.some((file) => file.path.startsWith('utils/')));
});

test('没有微信支付', () => {
  for (const file of files) {
    assert.doesNotMatch(file.text, /requestPayment|requestOrderPayment|requestPluginPayment/, file.path);
  }
});

test('没有员工入口、员工接口和员工字段', () => {
  for (const file of files) {
    assert.doesNotMatch(file.text, /员工|店员|店长|operator|\/staff|\/admin/i, file.path);
  }
});

test('会员端只调用会员接口，不调用记账写接口', () => {
  for (const file of files) {
    assert.doesNotMatch(file.text, /\/recharge|\/consume|\/reversal|\/members\/open/, file.path);
  }
});
