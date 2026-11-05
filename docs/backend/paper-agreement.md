# 开单上传纸质协议单 — 说明

> **日期：** 2026-11-05（Asia/Shanghai）
> **来由：** 坤总 2026-11-05：「签合同这个不签电子合同了 改成上传纸质协议单 用户可以再小程序查看 其他不变」。
> **开关：** `SIGN_MODE`，默认 `paper`（纸质协议单）；写 `esign` 回到电子签（e签宝那一套代码全部保留，见 [m4-esign-sandbox.md](./m4-esign-sandbox.md)）。`ESIGN_PRODUCTION_ENABLED` 仍保持 `false`。

---

## 1. 流程

店员在手机工作台开单：

1. 输顾客手机号（新顾客上传协议单时一起开卡）。
2. 填会员权益金额，选权益方案（有启用的方案时；只有一个就自动带上，没有也能开）。
3. 请顾客在纸质协议单上签字，店员点「拍照 / 相册」拍下来，最多 9 张，可以点开放大、删掉重拍。
4. 点「上传协议单并充值」，确认一次（给谁、哪个方案、多少钱、几张照片），照片一张张传上去，再交单。**交单成功即充值到账**（代替原来的「顾客签完合同才到账」）。
5. 弹会员小程序码给顾客扫码登录，和原来一样。

会员在小程序「我的权益单」里看到这份协议单（标「纸质」），点开能看协议单照片、会员权益金额是否到账、权益方案内容。

商家后台「权益单 → 协议单与签署」能看所有协议单照片、补传漏拍的照片；照错的照片由超级管理员或开单门店的店长删除，要写原因，至少留一张。纸质模式下后台不再显示「发起签署」，开单只在手机工作台。

## 2. 接口

| 接口 | 谁能用 | 说明 |
| --- | --- | --- |
| `GET /sign-flows/config` | 员工 | `{ mode: 'PAPER' \| 'ESIGN', maxPhotos: 9, maxPhotoBytes: 8MB }`。小程序和后台按它决定显示哪一套 |
| `POST /sign-flows/photos` | 员工 | multipart 字段 `file`，一次一张。只认 JPG / PNG / WebP（按文件头判断，不信文件名），≤ 8MB。返回照片 id |
| `POST /sign-flows/paper` | 员工（本店、在营门店） | `{ memberId, storeId, benefitPlanId?, rechargeAmountCent, photoIds[1..9], requestId }`。建一份已签署的协议单并充值。同一个 `requestId` 重试只开一单、充一次；内容不一样回 409 |
| `POST /sign-flows/:id/photos` | 本店员工、超管 | 补传照片，总数不超过 9 张 |
| `POST /sign-flows/:id/photos/:photoId/remove` | 超管、开单门店店长 | `{ reason }`，至少留一张。文件从存储里删掉，库里留一行记谁、何时、为何删 |
| `GET /sign-flows/:id/photos/:photoId` | 本店员工、超管 | 照片内容，`Cache-Control: private, no-store` |
| `GET /members/me/sign-flows/:id/photos/:photoId` | 会员本人 | 同上 |
| `POST /sign-flows/:id/refresh` | 本店员工、超管 | 纸质协议单只做一件事：充值那一步中途出错时补上（同一张单不会多充） |

`POST /sign-flows`（发起电子签）在纸质模式下回 400「现在开单改为上传顾客签字的纸质协议单，不再发起电子签」。

## 3. 数据

- 复用 `SignFlow`，新增 `kind`（`ESIGN` / `PAPER`）。纸质协议单建出来就是 `SIGNED`、`env` 无意义（界面不标「测试签署」）、没有模板（`templateId` 为空），直接挂 `benefitPlanId`。会员的权益列表、我的权益单、后台列表都照常能用。
- 新表 `agreement_photos`：机构、所属协议单、上传人、对象存储位置、类型、大小、上传/挂上/删除时间、删除人和原因。照片先传后挂；传上来 24 小时内没交单的不能再用，别人传的不能拿来交单。
- 数据库约束兜底：纸质协议单必须已签署、有门店、有金额、有签署时间、没有模板和 e签宝编号；`kind` 建好不能改；挂上的照片不能物理删除、不能换协议单、删除标记不能撤回、存储位置不能改。
- 充值走 `WalletService`，请求号 `sign-flow-<协议单 id>`，和电子签签完充值是同一条路，备注「纸质协议单上传后充值」。
- 操作记录：「上传纸质协议单」「补传协议单照片」「删除协议单照片」。

## 4. 照片是个人信息

照片上有顾客姓名、电话和签字：

- 只放私有对象存储（`agreements/<机构>/<随机名>`，和库里的 id 无关），不给公开链接；只经带登录的接口给会员本人、开单门店的员工和超管看。
- 每日备份会把本机存储目录（含照片）一起打包；用 OSS 时照片在 OSS 里。
- **不要把真实协议单照片放进仓库、截图或知识库。** 截图用 `apps/member-mp/preview/fixtures/` 里脚本画的演示样张。
- 小程序隐私保护指引要声明「选中的照片或视频」「摄像头」用于上传协议单（见 [deploy/README.md](../../deploy/README.md) 第 4 节）。

## 5. 冲正

后台对「纸质协议单上传后充值」那笔照样能冲正（超管或原门店店长）。冲正后协议单仍是已签署，会员页和后台显示「充值已冲正，金额已撤回」。要重新给钱就重新开单。

## 6. 本地截图

- 工作台：`node tools/mp-preview/shoot.mjs apps/member-mp/preview/staff-scenario.mjs --out <目录>`（接口默认纸质模式）。
- 会员看协议单：`node tools/mp-preview/shoot.mjs apps/member-mp/preview/paper-scenario.mjs --out <目录>`。
- 后台：`node apps/admin-web/preview/shoot.mjs --out <目录> --only paper`。
- 截电子签那一套：接口带 `SIGN_MODE=esign` 和假电子签平台，见各场景文件开头。
