# 电子签 · 前端配合要点

后端接口见 [backend/m4-esign-sandbox.md](./backend/m4-esign-sandbox.md)。本页只写会员小程序和商家后台要配合的地方。e签宝的具体参数以 [e签宝开放平台](https://open.esign.cn) 的「小程序集成签署」文档为准，下面写的是本项目的用法和注意事项。

## 会员小程序

### 页面流程

1. 首页调 `GET /members/me/sign-flows?status=PENDING`。有待签的权益单就先引导签署（设计规范：未签权益单进首页先引导签署）。
2. 签署页先展示 `GET /members/me/sign-flows/:id` 里的权益内容（`benefitPlan.items`、`rules`），底部固定「去签署」。带会员权益金额（`rechargeAmountCent`）的，在权益内容上面单独一张卡显示金额，没签时写「签署完成后充值到你的余额」，`recharged=true` 时写「已充值到你的余额」。
3. 点「去签署」时调 `POST /members/me/sign-flows/:id/sign-url` 拿 `signUrl`，用 `<web-view src="{{signUrl}}">` 打开。**每次打开前都重新取，不要缓存链接。**
4. 签完回到小程序（`onShow` 或签署页跳回）时调 `POST /members/me/sign-flows/:id/refresh`，按返回的 `status` 显示结果：`SIGNED` 已签署，`PENDING` 仍待签署，`REJECTED` / `EXPIRED` / `CANCELED` 显示对应文案。
5. 已签署且 `hasPdf=true` 时可查看合同：`wx.downloadFile` 请求 `GET /members/me/sign-flows/:id/pdf`（带 `Authorization` 头），再 `wx.openDocument({ fileType: 'pdf' })`。
6. `sandbox=true` 时界面标「测试签署」。
7. 首页权益摘要取 `GET /members/me/benefits` 第一项的 `items` 前 3 条。

会员端接口里没有任何员工信息，也不要在页面上显示发起店员。

### web-view 与业务域名

- 小程序 `web-view` 只能打开已配置为「业务域名」的地址。e签宝的签署页在 e签宝的域名下，正式上线前需要按 e签宝文档把它的签署页域名加到小程序业务域名（通常要向 e签宝要校验文件）。沙箱和正式的签署页域名不同。
- 入职前用的是微信测试号。开发者工具里可以勾选「不校验合法域名、web-view（业务域名）」先跑通；真机预览以测试号的实际能力为准。
- `ESIGN_REDIRECT_URL` 决定签完后签署页跳去哪里。小程序里一般配成一个能调 `wx.miniProgram.navigateBack` 或 `redirectTo` 的 H5 中间页；不配则停在 e签宝的完成页，会员手动返回即可（返回后仍会走第 4 步刷新）。

### 刷脸

e签宝签署时如果需要刷脸实名，在小程序 web-view 里要走「中间页」：签署 H5 通过 `wx.miniProgram.navigateTo` 跳到我们小程序里的一个中间页，中间页再按 e签宝文档跳转 e签宝的刷脸 / 公证签小程序，完成后带结果回到签署 H5。中间页的路径、跳转参数和回跳参数以 e签宝「小程序内嵌 H5 签署」文档为准，前端实现时对照那份文档写。沙箱阶段可以先用短信验证码等非刷脸方式完成签署，不阻塞联调。

## 员工小程序（开单）

- 「开单」页 `pages/order/order`：输手机号 → 填权益（第一项会员权益金额）→ `POST /sign-flows` 带 `rechargeAmountCent` 和 `requestId` → 屏幕上把 `signUrl` 画成二维码请顾客扫码签 → 每 4 秒 `POST /sign-flows/:id/refresh`，最多 10 分钟，之后点「刷新状态」。
- 链接过期或要换新时调 `POST /sign-flows/:id/sign-url`。
- `status=SIGNED` 且 `rechargeEntryId` 有值才显示「已充值到账」；已签署但还没写上流水号时显示「正在充值」，继续查。
- 到账后调 `GET /member-app/code`，弹出会员小程序码请顾客扫码登录；`demo=true` 时画演示码并标「演示码」，`image=null` 时显示 `message`。

## 商家后台

- 权益方案、模板只有超管能新建和修改，其他角色只读（按角色藏按钮）。
- 模板表单：`esignTemplateId`、名称、关联权益方案；「会员签字」「商家盖章」两个关键字放在「高级」里，默认不用改。保存时后端会到 e签宝核对模板，失败时直接显示返回的提示。
- 发起：选会员、模板、门店，提交时带一个新生成的 `requestId`。409 表示这位会员还有一份没签完的，提示先签完或撤销。返回里的 `signUrl` 可以做成二维码让会员当场扫码签。
- 列表：带会员权益金额的在标题下写「会员权益金额 X 元 · 签完后充值 / 已充值到账 / 未签成，没有充值」。状态标签 `PENDING` 待签署、`SIGNED` 已签署、`REJECTED` 已拒签、`EXPIRED` 已过期、`CANCELED` 已撤销、`DRAFT` 发起中；`env=SANDBOX` 时加「测试签署」标签。提供「刷新状态」（`POST /sign-flows/:id/refresh`）、「下载合同」（`hasPdf=true` 时）、「撤销」（超管和发起门店店长可见，需二次确认并填原因）。
