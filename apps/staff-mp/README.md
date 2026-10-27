# 商家小程序（员工端）

店员在门店用的小程序：查会员余额、开卡、充值、扫会员码消费、看本店流水；店长和超级管理员还能冲正。只记账，不收款，不接任何支付。

**消费必须先用手机扫顾客的会员码**（顾客在会员小程序首页点「会员码」），扫到才能填金额，不能直接输入扣款。

微信原生 + TypeScript。接口说明见 [docs/backend/m1-auth-stores.md](../../docs/backend/m1-auth-stores.md)、[docs/backend/m2-ledger.md](../../docs/backend/m2-ledger.md) 和 [docs/backend/pay-code.md](../../docs/backend/pay-code.md)。

## 页面

| 页面 | 路径 | 做什么 |
| --- | --- | --- |
| 店员登录 | `pages/login/login` | 微信手机号一键登录。只有已开通、在职的店员能进 |
| 工作台（底部第一栏） | `pages/index/index` | 当前门店；最上面「扫码消费」；输入手机号查会员；新会员开卡；最近办理过的 5 位会员 |
| 会员 | `pages/member/member` | 全公司通用的总余额；「充值」「扫码消费」（扫到的必须是这位会员的码）；在你的门店办理过的最近 10 笔（超级管理员看全部门店） |
| 记账 | `pages/entry/entry` | 充值或消费：填金额（元）实时显示记账后余额，二次确认后提交。消费页显示「已扫码 · 几点前有效」，没带码时只有「扫会员码」按钮；码过期、用过时弹窗「重新扫码」，金额不用重填 |
| 开卡 | `pages/open/open` | 手机号、称呼（选填），记在当前门店；开完可直接去充值 |
| 本店流水（底部第二栏） | `pages/ledger/ledger` | 当前门店的流水，按天分组，可选今天 / 近 7 天 / 近 30 天和类型 |
| 流水详情 | `pages/ledger-detail/ledger-detail` | 一笔的全部信息；超级管理员或这家店的店长可以冲正，店员看到「请联系店长」 |
| 我的（底部第三栏） | `pages/mine/mine` | 姓名、当前门店、角色、退出登录 |
| 切换门店 | `pages/stores/stores` | 一人在多家店有角色时切换。停用的门店不能选 |

## 记账为什么不会记重、记错

- 金额在程序里一律是整数分，只在输入和显示时换成元（`utils/money.ts`），最多两位小数，单笔 1 分到 100 万元。
- 每次点「确认」生成一个请求号。网络断了、没收到结果时，页面锁住金额，只能「重试」，重试带同一个请求号，服务端只记一笔。
- 消费前先按当前余额拦一次「余额不足」；最终以服务端为准（别人刚扣过时会提示没记上并刷新余额）。
- 冲正每笔只能一次，原因必填；服务端再按权限和「只冲一次」校验。
- 消费带着扫到的会员码提交。码是一次性的，扫码后 5 分钟内由扫码的人在这家店用；服务端在扣款的同一个事务里把码用掉。

## 本地开发

1. 起本机接口：`pnpm dev:api`。演示假手机号登录时在 `apps/api/.env` 里设 `WECHAT_PHONE_MOCK=true`（正式环境无效）。
2. 微信开发者工具导入 `apps/staff-mp`，AppID 填测试号（`project.config.json` 里的 `touristappid` 只是占位，Secret 不进仓库）。
3. 接口地址在 `config.ts`，默认 `http://localhost:3000`。开发者工具里勾选「不校验合法域名」。
4. 测试号拿不到手机号时，可以在开发者工具的 Storage 里加 `dev.mockPhone`（例如种子超管 `13800000000`）用假手机号登录；`dev.apiBase` 可以临时换接口地址。这两个只在开发版生效，界面上没有入口。

## 检查

```bash
pnpm --filter staff-mp typecheck   # 类型检查（页面和测试）
pnpm --filter staff-mp test        # 金额换算、手机号、北京时间、请求号、错误白话、冲正权限、扫码后的跳转和重扫判断
```

## 截图

用仓库里的预览工具（`tools/mp-preview`）在浏览器里跑这些页面，连本机接口，按店员的办理顺序截图：

```bash
WECHAT_PHONE_MOCK=true pnpm dev:api
node tools/mp-preview/shoot.mjs apps/staff-mp/preview/scenario.mjs --out /tmp/staff-shots
```

场景脚本会往**本机**数据库写演示门店（滨江店、西湖店）、员工（陈店长、李晓）、会员和流水，建议用一个空的本地库。消费都按真机顺序准备：会员出示会员码、店员扫码、带码扣款。截图里「扫到」的码是场景脚本现拿的会员码（`scanResult`）。预览是近似效果，真机以微信开发者工具为准。
