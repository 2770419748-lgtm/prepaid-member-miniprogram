# 小程序页面预览（截图用）

在本机浏览器里跑原生小程序页面，按场景脚本截图。页面代码原样使用，不用打开微信开发者工具；`wx.request` 发到本机接口，所以截图里是真实数据。

只用于开发自查和给坤总看页面截图，**不要部署**。真机行为以微信开发者工具和真机为准。

## 用法

```bash
# 1. 本机起接口（开发环境，打开假手机号登录）
WECHAT_PHONE_MOCK=true pnpm dev:api

# 2. 按场景截图，输出 PNG 和一张总览 overview.png
node tools/mp-preview/shoot.mjs apps/member-mp/preview/scenario.mjs --out /tmp/member-shots

# 查排版：换成小屏手机（iPhone SE 320×568），并且每张都截整页
node tools/mp-preview/shoot.mjs apps/staff-mp/preview/scenario.mjs --out /tmp/staff-se --screen 320x568 --full

# 只想在浏览器里点点看：
node tools/mp-preview/server.mjs apps/member-mp 5180
# 打开 http://127.0.0.1:5180/?route=pages/index/index
```

需要本机装有 Playwright 和 Chromium（`require('playwright')` 能找到即可）。场景脚本的写法见 `shoot.mjs` 顶部注释，例子见 `fixture/scenario.mjs`。

## 支持范围

- `App()`、`Page()`、`getApp()`、`getCurrentPages()`；页面生命周期 `onLoad / onShow / onReady / onHide / onUnload / onPullDownRefresh / onReachBottom / onPageScroll`。
- WXML：`view text button navigator image input textarea scroll-view canvas block`，`web-view`（不加载外部网页，只画占位并写明地址），`wx:if / wx:elif / wx:else`，`wx:for`（含 `wx:for-item`、`wx:for-index`），`{{ }}` 表达式，`hidden`，`data-*` 和 `bindtap / catchtap`，`button` 的 `open-type="getPhoneNumber"`。
- WXSS：`rpx`（按屏宽换算，默认 375）、`page` 和组件标签选择器、`@import`、`env(safe-area-inset-bottom)`。
- 外壳：状态栏、导航栏（含返回、胶囊）、`tabBar`（文字和图标）。
- wx 接口：`request`、本地存储、`login`、`getAccountInfoSync`、`getSystemInfoSync`、`getSetting / authorize / getLocation`、`openLocation`、`makePhoneCall`、`showToast / showLoading / showModal（含 editable）/ showActionSheet`、页面跳转五件套、`setNavigationBarTitle`、`stopPullDownRefresh`、`pageScrollTo`、`setClipboardData`、`downloadFile`（真的请求一次拿状态码，不存文件）、`openDocument`（提示一下）、`createSelectorQuery`（`select / selectAll` + `fields / boundingClientRect / node`，`canvas type="2d"` 的节点就是浏览器的 canvas）、`scanCode`（结果由场景里的 `scanResult` 给）、屏幕常亮和亮度（空操作）。地图和拨号是示意弹层。

不支持自定义组件 `Component()`、WXS、`template` 和 `import`。

**和真机的已知差异：** 预览里的 `canvas` 是普通网页画布，叠在它上面的文字、角标、遮罩都能正常显示；微信开发者工具和真机里画布会盖住叠在它上面的东西（2026-10-29 开单弹窗的「演示码」角标就是这样被挡住的）。所以页面上不要把任何内容叠在 `canvas` 上，预览截图看不出这类问题。没模拟的 wx 接口会在控制台提示，并走 `fail` 回调。

## 自检

```bash
node tools/mp-preview/shoot.mjs tools/mp-preview/fixture/scenario.mjs --out /tmp/mp-preview-fixture
```

三张截图都生成、没有报错即正常。
