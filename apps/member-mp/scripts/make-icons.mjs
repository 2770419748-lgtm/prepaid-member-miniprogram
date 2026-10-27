// 生成 tabBar 和页面用的 PNG 图标（小程序 tabBar 只认图片）。改了图形或颜色后重跑：
//   node apps/member-mp/scripts/make-icons.mjs
// 需要本机有 Playwright 和 Chromium。

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'images');

const GRAY = '#64748B';
const BLUE = '#1677FF';
const ORANGE = '#B45309';

const shapes = {
  home: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  ledger: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  mine: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  store: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  benefit: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 21l5-3 5 3-1.5-7"/>',
  contract: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  // 实心绿圆 + 白勾，签署成功页用。
  success: '<circle cx="12" cy="12" r="10" fill="#16A34A" stroke="none"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#FFFFFF" stroke-width="2"/>',
};

const icons = [
  ['tab-home', 'home', GRAY, 81],
  ['tab-home-active', 'home', BLUE, 81],
  ['tab-ledger', 'ledger', GRAY, 81],
  ['tab-ledger-active', 'ledger', BLUE, 81],
  ['tab-mine', 'mine', GRAY, 81],
  ['tab-mine-active', 'mine', BLUE, 81],
  ['icon-store', 'store', BLUE, 96],
  ['icon-ledger', 'ledger', GRAY, 96],
  ['icon-store-gray', 'store', GRAY, 96],
  ['icon-info', 'info', GRAY, 96],
  ['icon-logout', 'logout', GRAY, 96],
  ['icon-benefit', 'benefit', GRAY, 96],
  ['icon-contract', 'contract', GRAY, 96],
  ['icon-sign', 'contract', ORANGE, 96],
  ['icon-success', 'success', GRAY, 192],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, shape, color, size] of icons) {
  await page.setContent(
    `<html><body style="margin:0;background:transparent">
       <svg id="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes[shape]}</svg>
     </body></html>`,
  );
  await page.locator('#icon').screenshot({ path: join(out, `${name}.png`), omitBackground: true });
}
await browser.close();
console.log(`已生成 ${icons.length} 个图标到 ${out}`);
