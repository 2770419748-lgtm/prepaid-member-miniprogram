# 会员小程序

微信原生 + TypeScript。会员用微信手机号登录，查看余额、使用明细、可用门店和会员权益，在线签署门店发来的权益单，到店消费时出示会员码。充值和消费只在门店线下记账，这里**没有任何支付能力**，也没有任何员工入口或员工信息。

## 页面

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 首页 | `pages/index/index`（tab） | 会员身份、余额大数字、会员权益摘要（第一个方案的前 3 条，标已签署 / 待签署；一个方案都没有时显示储值说明）、待签提醒条、「可用门店 · N家」、最近 3 条明细。没开卡时余额 0 元并提示到门店开卡。有待签的权益单时，每份每天第一次进首页先打开签署页 |
| 明细 | `pages/ledger/ledger`（tab） | 按天分组（北京时间），全部 / 充值 / 消费，下拉刷新、触底加载 |
| 明细详情 | `pages/ledger-detail/ledger-detail` | 金额、门店、时间、这笔之后余额、记录编号；撤销记录可查看原记录 |
| 可用门店 | `pages/stores/stores` | 店名、地址、营业时间；同意定位后显示距离、近的在前；导航（`wx.openLocation`）和电话（`wx.makePhoneCall`）；没有门店时灰字提示 |
| 会员权益 | `pages/benefits/benefits` | 只读：每个权益方案的条目和使用规则，已签署 / 待签署标签；待签的「去签署」，签过的「查看权益单」，没办过的提示到店咨询 |
| 我的权益单 | `pages/sign-list/sign-list` | 自己的全部权益单（不含发起中的），状态、测试签署标签、发起或签署日期 |
| 权益单 | `pages/sign/sign?id=` | 门店开单时填了会员权益金额的，最上面显示金额和「签署完成后充值到你的余额」；权益内容和规则全文可滚，底部固定「我已阅读」+「去签署」；签完回来自动核对，成功页可回首页或查看合同（PDF）；拒签、过期、被撤销用白话说明 |
| 签署页 | `pages/sign-webview/sign-webview` | 只放一个 `web-view` 打开电子签平台的签署页，只接受 https 链接 |
| 会员码 | `pages/paycode/paycode` | 首页余额卡上的「会员码」进入。二维码（18 位数字，一次性，60 秒有效，每 30 秒自动换，可手动刷新）和可用余额；门店扫到后显示「某某店已扫码」并停止换码；扣款后显示金额、门店、时间、剩余余额，可查看这笔明细。出示时屏幕常亮调亮，截屏录屏时隐藏画面，截屏后马上换码 |
| 我的 | `pages/mine/mine`（tab） | 称呼和打码手机号、明细、会员权益、我的权益单、门店、储值说明、退出登录 |
| 登录 | `pages/login/login` | `getPhoneNumber` 手机号快捷登录 |

「冲正」对会员一律说「撤销」：消费撤销是钱退回余额，充值撤销是钱从余额扣回。

## 接口

只调用会员接口，全部带 `Authorization: Bearer`，401 自动回登录页：

- `POST /auth/member/wx-phone` 登录
- `GET /members/me`、`GET /members/me/wallet`、`GET /members/stores`
- `GET /ledger`、`GET /ledger/:id`（只返回自己的，不含操作店员和备注）
- 权益和签署（[docs/backend/m4-esign-sandbox.md](../../docs/backend/m4-esign-sandbox.md) 4.4、[docs/esign-frontend.md](../../docs/esign-frontend.md)）：`GET /members/me/benefits`、`GET /members/me/sign-flows`（首页用 `status=PENDING` 判断要不要引导）、`GET /members/me/sign-flows/:id`、`POST .../:id/sign-url`（每次打开签署页前现取，不缓存）、`POST .../:id/refresh`（从签署页回来时调）、`GET .../:id/pdf`（`wx.downloadFile` 带登录头，再 `wx.openDocument`）

- 会员码（[docs/backend/pay-code.md](../../docs/backend/pay-code.md)）：`POST /members/me/pay-code` 取新码，`GET /members/me/pay-code/:id` 每 2 秒查一次有没有被扫、扣了多少

接口返回 `sandbox=true` 时界面标「测试签署」。二维码在本机画（`utils/qrcode.ts`，只编数字），不依赖外部服务。

金额全是整数分，只在显示时转成元（`utils/format.ts`，整数运算）。

## 本机运行

1. 起本机接口：`apps/api/.env` 里 `WECHAT_PHONE_MOCK=true`，然后 `pnpm dev:api`。
2. 微信开发者工具导入本目录，AppID 填测试号（Secret 不进仓库），勾选「不校验合法域名」。
3. 测试号拿不到真实手机号时，在开发者工具 Storage 里加 `dev_mock_phone`（如 `13900001111`），点登录就用这个号。只有开发版会带上，正式版忽略；接口也只在开发环境认。
4. 接口地址在 `utils/config.ts`，按开发版 / 体验版 / 正式版区分。现在不部署，体验版和正式版留空。
5. 签署页用 `web-view` 打开电子签平台的页面，合同用 `downloadFile` 下载：上线前要在小程序后台把电子签平台的签署页域名加进「业务域名」，接口域名加进 request 和 downloadFile 合法域名。开发者工具里勾「不校验合法域名、web-view（业务域名）」即可先跑通。

## 测试和截图

```bash
pnpm --filter member-mp test        # 金额、北京时间、分组、距离排序、登录凭证、权益和签署的显示规则、会员码二维码（用 jsQR 反解核对）和刷新规则；静态检查没有支付和员工信息
pnpm --filter member-mp typecheck

# 截图：先起本机假电子签平台和本机接口，再按场景准备演示数据并截图
# （会在本机库里建演示门店、会员、权益方案和权益单；不连任何外部服务）
pnpm --filter member-mp exec tsx preview/fake-esign.mjs      # 3901，控制口 3902
WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api
node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots
```

假电子签平台复用接口测试里的 `apps/api/test/support/fake-esign.ts`。截图脚本通过它的控制口把演示会员的权益单标成「签好了」，相当于会员在签署页签完。

会员码那几张图：脚本从页面上的二维码认出码（和店员手机扫到的一样），再用本机接口扫码、扣款，页面自己轮询到「已扫码」「消费成功」。每跑一次会扣演示会员周女士一笔，余额不够 100 元时自动补充值。

tabBar 和页面图标由 `scripts/make-icons.mjs` 生成。

## 还没做

- 签署时需要刷脸实名的「中间页」（见 [docs/esign-frontend.md](../../docs/esign-frontend.md)「刷脸」）：沙箱阶段用短信验证码签，等拿到真实沙箱凭据联调时按电子签平台文档补。
- 签完自动跳回小程序（`ESIGN_REDIRECT_URL` 指向的 H5 中间页）：现在签完停在电子签平台的完成页，会员点返回后小程序自动核对结果。
