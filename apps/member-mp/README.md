# 会员小程序

微信原生 + TypeScript。会员用微信手机号登录，查看余额、使用明细和可用门店。充值和消费只在门店线下记账，这里**没有任何支付能力**，也没有任何员工入口或员工信息。

## 页面

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 首页 | `pages/index/index`（tab） | 会员身份、余额大数字、储值说明、「可用门店 · N家」、最近 3 条明细。没开卡时余额 0 元并提示到门店开卡 |
| 明细 | `pages/ledger/ledger`（tab） | 按天分组（北京时间），全部 / 充值 / 消费，下拉刷新、触底加载 |
| 明细详情 | `pages/ledger-detail/ledger-detail` | 金额、门店、时间、这笔之后余额、记录编号；撤销记录可查看原记录 |
| 可用门店 | `pages/stores/stores` | 店名、地址、营业时间；同意定位后显示距离、近的在前；导航（`wx.openLocation`）和电话（`wx.makePhoneCall`）；没有门店时灰字提示 |
| 我的 | `pages/mine/mine`（tab） | 称呼和打码手机号、明细、门店、储值说明、退出登录 |
| 登录 | `pages/login/login` | `getPhoneNumber` 手机号快捷登录 |

「冲正」对会员一律说「撤销」：消费撤销是钱退回余额，充值撤销是钱从余额扣回。

## 接口

只调用会员接口，全部带 `Authorization: Bearer`，401 自动回登录页：

- `POST /auth/member/wx-phone` 登录
- `GET /members/me`、`GET /members/me/wallet`、`GET /members/stores`
- `GET /ledger`、`GET /ledger/:id`（只返回自己的，不含操作店员和备注）

金额全是整数分，只在显示时转成元（`utils/format.ts`，整数运算）。

## 本机运行

1. 起本机接口：`apps/api/.env` 里 `WECHAT_PHONE_MOCK=true`，然后 `pnpm dev:api`。
2. 微信开发者工具导入本目录，AppID 填测试号（Secret 不进仓库），勾选「不校验合法域名」。
3. 测试号拿不到真实手机号时，在开发者工具 Storage 里加 `dev_mock_phone`（如 `13900001111`），点登录就用这个号。只有开发版会带上，正式版忽略；接口也只在开发环境认。
4. 接口地址在 `utils/config.ts`，按开发版 / 体验版 / 正式版区分。现在不部署，体验版和正式版留空。

## 测试和截图

```bash
pnpm --filter member-mp test        # 金额、北京时间、分组、距离排序、登录凭证；静态检查没有支付和员工信息
pnpm --filter member-mp typecheck

# 截图：先起本机接口，再按场景准备演示数据并截图（会在本机库里建演示门店和会员）
node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots
```

tabBar 和页面图标由 `scripts/make-icons.mjs` 生成。

## 还没做

- 权益单列表、签署入口和结果页（等 M4 电子签沙箱接口），沙箱期标「测试签署」。
- 首页权益摘要：现在是储值说明，M4 后换成会员签过的权益条目；有待签权益单时先引导签署。
