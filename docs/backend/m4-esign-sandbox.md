# M4 · 电子签沙箱 — 后端说明

> **状态：** 已实现（`apps/api` 的 `EsignModule`、`EsignConfigModule`、`StorageModule`）。只连 e签宝 **沙箱**。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **协作：** 2026-10-27 起坤总授权 Claude 端到端推进开发，测试与 CI 通过后自行合并。不部署、不接微信支付、不打开电子签正式开关。  
> **硬约束：** `ESIGN_PRODUCTION_ENABLED` 保持 `false`；密钥不进仓；合同 PDF 不进 Git。企业章正式能力属 M6。  
> **前端配合：** [../esign-frontend.md](../esign-frontend.md)　**开关与切换：** [../esign-switch.md](../esign-switch.md)

---

## 1. 做了什么

| 能力 | 说明 |
| --- | --- |
| 权益方案 | 超管维护标题、简介、权益条目（1–20 条）、适用规则。会员首页取前 3 条 |
| 权益单模板 | 把 e签宝「文件模板」绑到本系统，可关联权益方案。绑定时到 e签宝核对模板是否存在 |
| 发起签署 | 店员选会员和模板发起。会员个人签（第 1 步），签完由平台自动盖商家企业章（第 2 步） |
| 签署链接 | 发起时返回一次；会员端每次打开签署页前重新取 |
| 状态同步 | e签宝回调（验签）或主动刷新，都以回头查询 e签宝的结果为准 |
| 合同归档 | 签完后下载 PDF 存对象存储，库里只记 `pdfObjectKey`。会员和门店可下载 |
| 撤销 | 超管或发起门店的店长可撤销待签署的权益单，e签宝同步撤销 |
| 开单充值 | 发起时可带「会员权益金额」，写进合同；会员签完后自动充值到余额（2026-10-29 起，见第 10 节） |

## 2. 规则

1. **只连沙箱。** 调用环境由 `ESIGN_API_HOST` 决定：沙箱网关 → `SANDBOX`；正式网关 → `PRODUCTION`，且必须 `ESIGN_PRODUCTION_ENABLED=true`，否则在发请求前拒绝（503），库里不留记录。其他地址一律拒绝。本机地址只给测试和本地演示的假沙箱，`NODE_ENV=production` 时不认。每次调用 e签宝都重新核对一次。
2. **`SignFlow.env` 等于真实调用环境。** 沙箱开关打开前不可能写出 `PRODUCTION`。
3. **同一会员同一模板最多一份未签完的**（发起中 / 待签署）。数据库部分唯一索引兜底，避免两位店员同时点发起、多算一份钱。签完、拒签、过期、撤销之后可以再发。
4. **防重复提交：** 前端可带 `requestId`，重复提交返回第一次的结果。
5. **会员实名由 e签宝核验。** 只把手机号作为签署人账号传给 e签宝，不把开卡登记的称呼当姓名传（称呼不是实名）。
6. **企业章：** 沙箱里不传企业签署方信息，由 e签宝按「平台方自动盖章」用应用所属企业（沙箱模拟企业）的默认章。正式企业章属 M6。
7. **回调验签失败返回 401，不动库。** 验签通过也不直接采信回调里的状态，而是回头查询 e签宝再写库。时间戳与本机相差超过 10 分钟视为重放。
8. **状态只往前走：** 已签署、已拒签、已过期、已撤销之后不再变化。
9. **会员端看不到员工信息**，也看不到其他会员的权益单（404）。店长、店员只看本店发起的，超管看全部。
10. 权益方案、模板不提供删除，用 `ARCHIVED` 下架。下架的方案不再出现在会员的权益列表，除非他签过或待签。

## 3. 权限

| 角色 | 权益方案 / 模板 | 发起签署 | 查看 / 刷新 / 下载合同 | 撤销 |
| --- | --- | --- | --- | --- |
| 超级管理员 | 新建、修改 | 任意门店 | 全部 | 任意 |
| 店长 | 只读 | 本店 | 本店发起的 | 本店发起的 |
| 店员 | 只读 | 本店 | 本店发起的 | 不能 |
| 会员 | 只看在用的和自己签过的 | 不能 | 只看自己的 | 不能 |

发起时 `storeId` 必须是操作人有权限的门店（403）。会员不按开卡门店限制：余额全公司通用，任何门店都能给本公司会员发起，操作记录会写明门店和发起人。

## 4. 接口

所有列表都分页：`page`、`pageSize`（默认 20，最大 100），返回 `{ items, total, page, pageSize }`。

### 4.1 权益方案（店员登录）

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/benefit-plans` | 超管 | `{ title, summary?, items: [{ title, detail? }], rules?, status?: DRAFT \| ACTIVE }`，默认 `ACTIVE` |
| GET | `/benefit-plans` | 店员 | `status?` |
| GET | `/benefit-plans/:id` | 店员 | |
| PATCH | `/benefit-plans/:id` | 超管 | 任意字段；`status` 可为 `DRAFT` / `ACTIVE` / `ARCHIVED`；`summary`、`rules` 传空串清空 |

返回：`{ id, title, summary, items, rules, status, templateCount, createdAt, updatedAt }`。

### 4.2 权益单模板（店员登录）

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/contract-templates` | 超管 | `{ esignTemplateId, name, benefitPlanId?, status?, memberSignKeyword?, sealKeyword? }`。e签宝里没有这个模板 → 400；沙箱没配凭据 → 503 |
| GET | `/contract-templates` | 店员 | `status?`、`benefitPlanId?` |
| GET | `/contract-templates/:id` | 店员 | |
| PATCH | `/contract-templates/:id` | 超管 | 同上字段；`benefitPlanId: null` 取消关联；换 `esignTemplateId` 会重新核对 |

返回：`{ id, name, esignTemplateId, status, benefitPlan: { id, title } | null, memberSignKeyword, sealKeyword, createdAt, updatedAt }`。

### 4.3 签署（店员登录）

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/sign-flows` | 店员 | `{ memberId, templateId, storeId, rechargeAmountCent?, requestId? }`。`rechargeAmountCent` 是会员权益金额（分，1 分到 100 万元），会员必须已开卡，模板里必须有 `benefitAmount` 控件，否则 400。模板须启用。已有未签完的同类 → 409；模板里找不到签名 / 盖章关键字 → 400；e签宝报错 → 502（带 e签宝原话）；开关关闭却配了正式网关 → 503 |
| GET | `/sign-flows` | 店员 | `status?`、`memberId?`、`templateId?`、`storeId?` |
| GET | `/sign-flows/:id` | 店员 | 范围外 404 |
| POST | `/sign-flows/:id/refresh` | 店员 | 查询 e签宝并回写；签完则归档 PDF。归档失败时仍返回状态，`hasPdf=false`，下次刷新重试 |
| POST | `/sign-flows/:id/sign-url` | 店员 | 重新向 e签宝取会员签署链接并更新 `signUrl`（员工小程序屏幕上出码给会员扫）。不是待签署 → 409 |
| POST | `/sign-flows/:id/cancel` | 超管 / 发起门店店长 | `{ reason }`。只能撤销待签署的，否则 409 |
| GET | `/sign-flows/:id/pdf` | 店员 | `application/pdf`。还没归档 404 |

返回：

```text
{ id, title, status, env,
  member: { id, phone, name }, template: { id, name }, benefitPlan: { id, title } | null,
  store: { id, name } | null, initiator: { id, name } | null,
  signUrl,      // 只在 PENDING 时有值
  rechargeAmountCent,   // 会员权益金额（分），没填为 null
  rechargeEntryId,      // 签完充值的那笔流水，还没充值为 null
  hasPdf, signedAt, syncedAt, createdAt, updatedAt }
```

### 4.4 会员（会员登录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/members/me/benefits` | 在用的权益方案 + 自己签过或待签的方案。每项 `{ id, title, summary, items, rules, signFlow: { id, status, updatedAt } \| null }`。已签的排最前，其次待签 |
| GET | `/members/me/sign-flows` | 自己的权益单，`status?`。不含发起中的 |
| GET | `/members/me/sign-flows/:id` | 详情，带权益内容、`rechargeAmountCent` 和 `recharged`（是否已充值）。别人的 404 |
| POST | `/members/me/sign-flows/:id/sign-url` | `{ signUrl, sandbox }`，每次重新向 e签宝取。不是待签署 → 409 |
| POST | `/members/me/sign-flows/:id/refresh` | 从签署页回来时调用，同步状态 |
| GET | `/members/me/sign-flows/:id/pdf` | 自己签好的合同 PDF |

会员看到的权益单：`{ id, title, status, env, sandbox, benefitPlan: { id, title, summary, items, rules } | null, rechargeAmountCent, recharged, hasPdf, signedAt, createdAt, updatedAt }`。没有员工、门店、签署链接字段。

### 4.5 e签宝回调

`POST /webhooks/esign`，不需要登录，靠签名校验：

- 请求头 `X-Tsign-Open-SIGNATURE`、`X-Tsign-Open-TIMESTAMP`、`X-Tsign-Open-App-Id`。
- 签名 = HMAC-SHA256（应用 Secret，时间戳 + 按参数名排序拼接的查询参数值 + 原始请求体），小写十六进制。
- 验签失败 401；不认识的流程直接应答成功；处理出错返回 5xx，让 e签宝重试。
- 成功应答 `{ "code": "200", "msg": "success" }`。
- 回调地址由 `ESIGN_NOTIFY_URL` 传给 e签宝。本地没有公网地址收不到回调，靠刷新接口同步。

## 5. 状态对照

| 本系统 | 含义 | e签宝 `signFlowStatus` |
| --- | --- | --- |
| `DRAFT` | 发起中（店员刚点、e签宝还没建好的瞬间） | 0 |
| `PENDING` | 待签署 | 1 |
| `SIGNED` | 已签署（会员已签、商家章已盖） | 2 |
| `CANCELED` | 已撤销 | 3 |
| `EXPIRED` | 已过期 | 5 |
| `REJECTED` | 已拒签 | 7 |

其他值不认识时保持原状态并记日志。

## 6. 发起时后端做了什么

1. 核对环境和凭据；在库里占位一条 `DRAFT`（同时挡住重复发起）。
2. 查 e签宝模板的填写控件，只填模板里有的：

   | 控件 key | 填什么 |
   | --- | --- |
   | `contractNo` | 本系统流程号 |
   | `memberPhone` | 会员手机号 |
   | `memberName` | 开卡登记的称呼（可能为空，不是实名） |
   | `benefitTitle` | 关联的权益方案名称 |
   | `orgName` | 商家名称 |
   | `storeName` | 发起门店 |
   | `signDate` | 发起日期 `YYYY-MM-DD`（模板里用单行文本） |
   | `benefitAmount` | 会员权益金额，如 `1,000.00`（带了金额时必须有这个控件） |
   | `benefitAmountWords` | 会员权益金额大写，如 `壹仟元整`（可选） |

3. 用模板生成待签文件（`/v3/files/create-by-doc-template`），等文件就绪。
4. 在文件里检索两个关键字（默认「会员签字」「商家盖章」，可按模板改）：会员签名落在「会员签字」右侧 80pt，企业章盖在「商家盖章」上。找不到就报 400，不发起。
5. 发起流程（`/v3/sign-flow/create-by-file`）：会员第 1 步手动签，平台第 2 步自动盖章，签完自动结束。
6. 取会员签署链接；把 `DRAFT` 改成 `PENDING`，同一事务写操作记录 `SIGN_FLOW_CREATE`（payload：`memberId`、`templateId`、`env`，没有链接和密钥）。
7. 中途失败：删掉占位；如果 e签宝那边已建好而本地没记上，自动撤销那边的流程。

**模板作者须知：** 合同正文里写上「会员签字」「商家盖章」两处文字（或模板里自定义的关键字），每处只在签名区出现一次最稳妥；同一关键字出现多次时取最后一处。

## 7. 操作记录

| action | 何时 |
| --- | --- |
| `BENEFIT_PLAN_CREATE` / `BENEFIT_PLAN_UPDATE` | 新建 / 修改权益方案 |
| `CONTRACT_TEMPLATE_CREATE` / `CONTRACT_TEMPLATE_UPDATE` | 绑定 / 修改模板 |
| `SIGN_FLOW_CREATE` | 发起成功，记发起门店；带金额时 payload 有 `rechargeAmountCent` |
| `SIGN_FLOW_CANCEL` | 撤销，带原因 |
| `SIGN_FLOW_STATUS_CHANGE` | 回调或刷新后状态变化，系统写入，没有操作人，payload 带 `from`、`to`、`source` |
| `WALLET_RECHARGE` | 签完自动充值，和普通充值一样走 `WalletService`，操作人记发起的店员，payload 多一个 `signFlowId` |

## 8. 配置

| 变量 | 说明 |
| --- | --- |
| `ESIGN_APP_ID` / `ESIGN_APP_SECRET` | e签宝沙箱应用凭据，只放本机 `.env` |
| `ESIGN_API_HOST` | 默认 `https://smlopenapi.esign.cn`（沙箱） |
| `ESIGN_PRODUCTION_ENABLED` | 保持 `false` |
| `ESIGN_NOTIFY_URL` | 回调地址（公网可访问的 `…/webhooks/esign`）。不配就只靠刷新 |
| `ESIGN_REDIRECT_URL` | 会员签完后签署页跳回的地址。不配则停在 e签宝完成页 |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | 合同 PDF 对象存储（MinIO / S3 兼容）。`S3_FORCE_PATH_STYLE` 默认 true |
| `STORAGE_LOCAL_DIR` | 没配 S3 时的本机目录，默认 `apps/api/.storage/`（已在 `.gitignore`）。只用于开发 |

迁移：`20261029120000_sign_flow_recharge` 给签署加会员权益金额和充值流水号（见第 10 节）。`20261027220000_m4_esign_sandbox`：模板加签名 / 盖章关键字；签署加发起门店、发起人、标题、e签宝文件号、请求号、签署完成时间、最近核对时间；e签宝流程号唯一；部分唯一索引「同一会员同一模板只有一份未签完」；CHECK「离开发起中就必须有 e签宝流程号」。

## 9. 测试与验收

- `test/m4-esign-sandbox.integration.spec.ts`：20 项端到端，对着本机假 e签宝沙箱（`test/support/fake-esign.ts`，按 e签宝规则独立校验每个请求的签名）跑：模板核对、发起参数（会员先签、平台自动盖章、只传手机号）、重复发起、请求号重放、门店范围、会员只看自己、回调验签（错签名、错密钥、过期时间戳、无签名）、回调后签署完成并归档、重复回调不重复记录、刷新重试归档、撤销权限、开关关闭时正式网关被拒且不留记录。
- 单测：请求签名原文与算法、回调签名、状态映射、网关与开关护栏、客户端拒绝时不发请求、对象存储路径不越界。
- 验收演示：`scripts/m4-acceptance-demo.ts`，对着运行中的本地服务走 12 步并生成一页 HTML（脚本内说明了启动方式）。

### 用真实 e签宝沙箱联调（坤总本机）

1. 在 e签宝开放平台沙箱建应用，拿到 App ID / Secret，写进本机 `.env`（不要提交）。
2. 在沙箱控制台做一份文件模板：正文写「会员签字」「商家盖章」，需要自动填写的地方加单行文本控件，key 用第 6 节表里的名字。
3. 后台超管绑定模板 ID，给自己的手机号发起，用返回的链接在手机浏览器里签。
4. 本地收不到回调，签完后点刷新（或会员端回到小程序时自动刷新），状态变成已签署、合同可以下载。

**说明：** 开发环境连不上 e签宝，本次没有对着真实沙箱跑过，接口字段按 e签宝开放平台 v3 公开文档实现。第一次真实联调时如有字段出入，以 e签宝返回的报错为准修正（客户端在 `src/esign/client/esign.client.ts` 一处）。

## 10. 开单：会员权益金额签完才充值（2026-10-29）

坤总要求员工小程序开单一条龙：输手机号 → 填权益（第一项是会员权益金额）→ 签合同 → 自动充值 → 弹会员小程序码。坤总确认「**签完合同才到账**」。

1. **发起时只记金额，不动余额。** `POST /sign-flows` 带 `rechargeAmountCent`，金额填进合同的 `benefitAmount` / `benefitAmountWords` 控件。会员要先开卡（员工小程序在生成合同时给新顾客开卡）。
2. **合同发出后金额改不了。** 数据库触发器 `sign_flows_recharge_is_fixed`：离开发起中以后改金额直接报错；充值流水号一旦写上就不能改。CHECK 约束：金额 1 分到 100 万元；只有已签署、带金额的才可能有充值流水。
3. **签完才充值，只记一笔。** 回调、店员刷新、会员端刷新任何一路发现状态变成已签署，都调 `WalletService.creditSignedContract`。请求号固定是 `sign-flow-<权益单 id>`，账本按请求号去重，所以几路同时来、重复来、记完流水后进程挂了再来，都只有一笔。记完把流水 id 回写到 `rechargeEntryId`；回写没成功的，下次同步按请求号找回那笔再补上。
4. **充值先于归档。** 签完先充值再下载 PDF。充值失败时：回调返回 5xx，让 e签宝按它的策略重发；店员或会员刷新照常返回已签署的状态，日志报错，下一次刷新或回调再充。
5. **没签成不充值。** 撤销、拒签、过期都不充值。签完以后门店停用、会员被停用也照样充值（钱是签合同时说好的）。
6. 签完充值的流水和普通充值一样能冲正（店长 / 超管，带原因）。
7. 同一请求号换了金额重新提交 → 409。

### 会员小程序码（员工端弹给顾客扫）

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/member-app/code` | 店员 | `{ image, demo, message }`。`image` 是 `data:image/png;base64,…` 的小程序码，打开会员小程序首页；没配会员小程序时 `image=null`，本机演示（`WECHAT_PHONE_MOCK=true`）时 `demo=true`，员工端画一个演示码 |

用微信 `getwxacodeunlimit`（`scene=from=staff`），access token 和手机号登录共用一份缓存，生成的码缓存 12 小时。`WECHAT_MEMBER_CODE_ENV` 选正式版 / 体验版 / 开发版，默认正式版；会员小程序还没发布对应版本时返回「会员小程序还没发布这个版本」。

### 测试

- `test/sign-order.integration.spec.ts`：11 项，签前不充值、几路并发只充一次、记完流水后崩溃能补回、撤销 / 拒签 / 过期不充值、门店停用后照样充值、冲正、模板缺 `benefitAmount` 控件、金额校验、请求号换金额 409、触发器拦改金额、店员取签署链接、`/member-app/code` 权限。
- `test/member-app-code.spec.ts`、`test/money-words.spec.ts`：小程序码的缓存和重试、金额大写。
- **模板作者须知：** 要带金额开单，合同模板里加 `benefitAmount`（必须）和 `benefitAmountWords`（可选）两个单行文本控件。
