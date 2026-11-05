# 储值会员小程序（会员页 + 工作台）

微信原生 + TypeScript。**会员和员工共用这一个小程序**（2026-11-04 坤总定，原来的员工小程序 `apps/staff-mp` 已并进来）：

- 顾客用微信手机号登录，进**会员页**（`pages/`）：查看余额、使用明细、可用门店和会员权益，在线签署门店发来的权益单，到店消费时出示会员码。
- 店员用同一个按钮登录，服务端认出这个手机号是商家后台开过的在职员工，就直接进**工作台**（`staff/`）：扫码消费、查余额、开单、充值、本店流水、店长冲正。

充值和消费只在门店线下记账，这里**没有任何支付能力**。会员页上看不到任何员工入口和员工信息；权限一律由服务端按登录判断。

## 登录和分流

| 情况 | 去哪 |
| --- | --- |
| 普通顾客点「手机号快捷登录」 | 会员首页（第一次登录就建好会员，没开卡时提示到店开卡） |
| 手机号是本公司在职员工 | 直接进工作台，底部是工作台自己的三栏（工作台、本店流水、我的） |
| 员工在工作台点「切到我的会员卡」 | 自己手机号的会员首页，不用再点手机号授权；会员「我的」里多一行「回到工作台」，一点就回去 |
| 先当顾客登录过、后来才入职 | 会员「我的」里出现「进入工作台」，用微信手机号重新登录一次就进（换身份要重新验证手机号） |
| 员工被停用 | 员工登录马上失效；再登录就只是会员 |
| 超级管理员在后台改了员工手机号 | 旧手机上的员工登录作废，用新号重新登录 |
| 商家后台打开了「审核体验」 | 登录页底部才出现小字「审核体验入口」，给微信审核员用账号密码进演示公司的工作台（和真实数据隔开） |
| 退出登录 | 会员、员工两边的登录一起退掉 |

登录页是小程序的第一页（`pages/login/login`）。已经登录过的直接回到上次用的那一边，这一页不露面；规则在 `utils/mode.ts`。两边的登录分开存：会员在 `utils/session.ts`（`member_session`），员工在 `staff/utils/session.ts`（`staff.session`），本机记住现在用哪一边（`app_mode`）。都是 30 天有效，每天打开小程序时各自自动续期（`utils/keep-login.ts`、`staff/utils/keep-login.ts`）。正在用工作台时会员登录在后台失效，只清掉会员登录不打断工作台；反过来也一样。

小程序自带的 tabBar 只给会员页。工作台的三页（`staff/pages/index`、`ledger`、`mine`）是 `wx.reLaunch` 打开的，底部画自己的一栏（`staff/utils/nav.ts`），并藏掉左上角的「回首页」。两边的公共样式分开：会员页引入 `styles/member.wxss`，工作台引入 `staff/staff.wxss`，`app.wxss` 只放两边一样的基础样式。

## 会员页

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
| 会员码 | `pages/paycode/paycode` | 首页余额卡上的「会员码」进入。二维码（18 位数字，一次性，60 秒有效，每 30 秒自动换，可手动刷新）和可用余额；门店扫到后显示「某某店已扫码」并停止换码；扣款后显示金额、门店、订单号、商品金额、时间、剩余余额，可查看这笔明细。出示时屏幕常亮调亮，截屏录屏时隐藏画面，截屏后马上换码 |
| 我的 | `pages/mine/mine`（tab） | 称呼和打码手机号、明细、会员权益、我的权益单、门店、储值说明、退出登录。在职员工多一行「回到工作台」或「进入工作台」 |
| 登录 | `pages/login/login` | `getPhoneNumber` 手机号快捷登录，员工和顾客同一个按钮，见上面「登录和分流」 |

「冲正」对会员一律说「撤销」：消费撤销是钱退回余额，充值撤销是钱从余额扣回。

## 工作台（员工用，`staff/`）

**消费必须先用手机扫顾客的会员码**（顾客在小程序首页点「会员码」），**再扫九讯云小票上方的订单码、填商品应付金额**，最多抵 10%、一单最多 1000 元，同一张单全公司只能抵一次（2026-11-05，见 [order-offset.md](../../docs/backend/order-offset.md)），不能直接输入扣款。**开单的会员权益金额在顾客签完合同后才充值到账**，没签、撤销、拒签、过期都不充值。接口说明见 [docs/backend/m1-auth-stores.md](../../docs/backend/m1-auth-stores.md)、[m2-ledger.md](../../docs/backend/m2-ledger.md)、[pay-code.md](../../docs/backend/pay-code.md) 和 [m4-esign-sandbox.md](../../docs/backend/m4-esign-sandbox.md)（开单、签完充值）。

| 页面 | 路径 | 做什么 |
| --- | --- | --- |
| 工作台（底栏第一栏） | `staff/pages/index/index` | 当前门店；最上面「扫码消费」；输入手机号查会员，查不到时「为这个手机号开单」；「开单」入口；最近办理过的 5 位会员；最下面「切到我的会员卡」 |
| 会员 | `staff/pages/member/member` | 全公司通用的总余额；「充值」「扫码消费」（扫到的必须是这位会员的码）；「办理权益单」；待签署的权益单可「接着签」；在你的门店办理过的最近 10 笔（超级管理员看全部门店） |
| 记账 | `staff/pages/entry/entry` | 充值或消费：填金额（元）实时显示记账后余额，二次确认后提交。消费页显示「已扫码 · 几点前有效」，没带码时只有「扫会员码」按钮；码过期、用过时弹窗「重新扫码」，金额不用重填。消费还要「扫订单码」（扫不出来可手输单号，标「手输单号」），扫到马上查这张单抵过没有；填商品应付金额后自动填抵扣金额（最多 10%、一单最多 1000 元，余额不够就抵余额），改大会拦下 |
| 开单 | `staff/pages/order/order` | 四步：① 输顾客手机号（新顾客可填称呼）② 填权益：第一项「会员权益金额」，下面是权益方案的内容，选合同模板 ③ 生成合同，屏幕上出签署二维码请顾客用微信扫码签，每 4 秒自动查一次 ④ 签完自动充值到账，弹出小程序码请顾客扫码登录。新顾客在生成合同时开卡；店长和超级管理员可以撤销没签的合同 |
| 本店流水（底栏第二栏） | `staff/pages/ledger/ledger` | 当前门店的流水，按天分组，可选今天 / 近 7 天 / 近 30 天和类型 |
| 流水详情 | `staff/pages/ledger-detail/ledger-detail` | 一笔的全部信息；超级管理员或这家店的店长可以冲正，店员看到「请联系店长」 |
| 我的（底栏第三栏） | `staff/pages/mine/mine` | 姓名、当前门店、角色、切到我的会员卡、退出登录 |
| 切换门店 | `staff/pages/stores/stores` | 一人在多家店有角色时切换。停用的门店不能选 |

### 工作台记账为什么不会记重、记错

- 金额在程序里一律是整数分，只在输入和显示时换成元（`staff/utils/money.ts`），最多两位小数，单笔 1 分到 100 万元。
- 每次点「确认」生成一个请求号。网络断了、没收到结果时，页面锁住金额，只能「重试」，重试带同一个请求号，服务端只记一笔。
- 消费前先按当前余额拦一次「余额不足」；最终以服务端为准（别人刚扣过时会提示没记上并刷新余额）。
- 冲正每笔只能一次，原因必填；服务端再按权限和「只冲一次」校验。
- 消费带着扫到的会员码提交。码是一次性的，扫码后 5 分钟内由扫码的人在这家店用；服务端在扣款的同一个事务里把码用掉。
- 开单的会员权益金额写进合同，合同发出后就改不了（数据库也拦着）。顾客签完后服务端按权益单记一笔充值，请求号由权益单决定，不管刷新、回调、会员端查询来几次都只记一笔。

## 会员页的接口

会员页只调用会员接口，全部带 `Authorization: Bearer`，401 自动回登录页（`tests/constraints.test.ts` 静态检查会员页里出现的接口地址）：

- `POST /auth/wx-phone` 登录（员工和会员共用，返回 `principalType` 区分）；`POST /auth/member/session/renew` 续期（小程序回到前台时，每天最多一次）；`GET /auth/me` 看这个手机号能不能进工作台
- `GET /auth/review-demo`、`POST /auth/review-demo/login`：审核体验入口。超级管理员在商家后台「小程序审核入口」打开 7 天后入口才显示，规则见 [docs/backend/review-demo.md](../../docs/backend/review-demo.md)；截图场景 `preview/review-demo-scenario.mjs`
- `GET /members/me`、`GET /members/me/wallet`、`GET /members/stores`
- `GET /ledger`、`GET /ledger/:id`（只返回自己的，不含操作店员和备注）
- 权益和签署（[docs/backend/m4-esign-sandbox.md](../../docs/backend/m4-esign-sandbox.md) 4.4、[docs/esign-frontend.md](../../docs/esign-frontend.md)）：`GET /members/me/benefits`、`GET /members/me/sign-flows`（首页用 `status=PENDING` 判断要不要引导）、`GET /members/me/sign-flows/:id`、`POST .../:id/sign-url`（每次打开签署页前现取，不缓存）、`POST .../:id/refresh`（从签署页回来时调）、`GET .../:id/pdf`（`wx.downloadFile` 带登录头，再 `wx.openDocument`）

- 会员码（[docs/backend/pay-code.md](../../docs/backend/pay-code.md)）：`POST /members/me/pay-code` 取新码，`GET /members/me/pay-code/:id` 每 2 秒查一次有没有被扫、扣了多少

接口返回 `sandbox=true` 时界面标「测试签署」。二维码在本机画（`utils/qrcode.ts`，只编数字），不依赖外部服务。

金额全是整数分，只在显示时转成元（`utils/format.ts`，整数运算）。

## 本机运行

1. 起本机接口：`apps/api/.env` 里 `WECHAT_PHONE_MOCK=true`，然后 `pnpm dev:api`。
2. 微信开发者工具导入本目录，AppID 填测试号（Secret 不进仓库），勾选「不校验合法域名」。
3. 测试号拿不到真实手机号时，在开发者工具 Storage 里加 `dev_mock_phone`（如 `13900001111`），点登录就用这个号。只有开发版会带上，正式版忽略；接口也只在开发环境认。填种子超管 `13800000000` 或后台开过的员工手机号，登录就进工作台。
4. 接口地址在 `utils/config.ts`，按开发版 / 体验版 / 正式版区分。现在不部署，体验版和正式版留空。
5. 签署页用 `web-view` 打开电子签平台的页面，合同用 `downloadFile` 下载：上线前要在小程序后台把电子签平台的签署页域名加进「业务域名」，接口域名加进 request 和 downloadFile 合法域名。开发者工具里勾「不校验合法域名、web-view（业务域名）」即可先跑通。

## 测试和截图

```bash
pnpm --filter member-mp test        # 会员页：金额、北京时间、分组、距离排序、登录凭证、权益和签署、会员码；分流：打开去哪一边、两边登录失效互不打断；
                                    # 工作台（tests/staff/）：金额换算、手机号、请求号、冲正权限、扫码、开单步骤、二维码；静态检查没有支付、会员页没有员工信息
pnpm --filter member-mp typecheck

# 截图：先起本机假电子签平台和本机接口，再按场景准备演示数据并截图
# （会在本机库里建演示门店、会员、权益方案和权益单；不连任何外部服务）
pnpm --filter member-mp exec tsx preview/fake-esign.mjs      # 3901，控制口 3902
WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api
node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots          # 会员页
node tools/mp-preview/shoot.mjs apps/member-mp/preview/staff-scenario.mjs --out /tmp/staff-shots     # 工作台（店员的办理顺序）
node tools/mp-preview/shoot.mjs apps/member-mp/preview/merged-scenario.mjs --out /tmp/merged-shots   # 登录分流、切到会员卡、回到工作台
```

三个场景各用一个空的本地库跑，混在一个库里门店会互相干扰。工作台场景会建演示门店（滨江店、西湖店）、员工（陈店长、李晓）、会员、权益单和流水；开单那几张让假电子签平台把合同标成「顾客已签」。

假电子签平台复用接口测试里的 `apps/api/test/support/fake-esign.ts`。截图脚本通过它的控制口把演示会员的权益单标成「签好了」，相当于会员在签署页签完。

会员码那几张图：脚本从页面上的二维码认出码（和店员手机扫到的一样），再用本机接口扫码、扣款，页面自己轮询到「已扫码」「消费成功」。每跑一次会扣演示会员周女士一笔，余额不够 100 元时自动补充值。

tabBar 和页面图标由 `scripts/make-icons.mjs` 生成。

## 本机试开单（不连电子签）

本机没有电子签沙箱时，用假电子签平台模拟顾客签字：

1. 按上面「测试和截图」里的两行命令起假电子签平台和接口。
2. 商家后台「合同模板」里新建模板，电子签模板 ID 填 `member-benefit-demo`，绑上一个权益方案，启用。
3. 工作台「开单」走到签合同那一步后，电脑浏览器打开 <http://127.0.0.1:3902>，在待签署的单子后面点「模拟顾客签完」。
4. 回到小程序，几秒内自动显示「已充值到账」并弹出小程序码。本机没配小程序时显示的是演示码，扫了打不开。

小程序码由接口 `GET /member-app/code` 现取（微信 `getwxacodeunlimit`，缓存 12 小时）。正式上线前在 `apps/api/.env` 里配好 `WECHAT_MEMBER_APPID`、`WECHAT_MEMBER_SECRET`；小程序还没发正式版时，`WECHAT_MEMBER_CODE_ENV` 可以改成 `trial`（体验版）。

## 还没做

- 签署时需要刷脸实名的「中间页」（见 [docs/esign-frontend.md](../../docs/esign-frontend.md)「刷脸」）：沙箱阶段用短信验证码签，等拿到真实沙箱凭据联调时按电子签平台文档补。
- 签完自动跳回小程序（`ESIGN_REDIRECT_URL` 指向的 H5 中间页）：现在签完停在电子签平台的完成页，会员点返回后小程序自动核对结果。
