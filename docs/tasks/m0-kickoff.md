# M0 开工说明 — 储值会员小程序 · 工程基础

> **由全栈开发直接实现**（云端写码落地；开 PR 后经开发部→总经理转坤总确认再合入；合入前不 merge/部署）  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram（当前 **空仓**，默认分支 `main`，公开）  
> **负责人：** 全栈开发（实现 + 开 PR + 联调）· Code Review 由技术部  
> **预估：** 约 6 人天 · **无前置依赖**  
> **下游：** M1 账号门店依赖本里程碑完成  
> **修订：** 2026-10-27 23:20 — 对齐技术部硬约束；23:25 — 口径改为全栈直接实现（待坤总确认后落地）：`JWT_SECRET` / 可选 `REDIS_URL`、微信 env 用 `WECHAT_*`、模块边界注释、flag 单测

---

## 0. 目标与非目标

### 目标（Done 定义）

在空仓上搭好 monorepo 骨架，使后续 M1–M6 可并行推进，且满足：

1. 仓规范、README、环境变量样例、本地一键启动说明齐全  
2. 后端 NestJS + Prisma + **PostgreSQL** 可 `migrate` / `generate` / 启动健康检查  
3. 商家网页后台 Vue3 + Ant Design Vue 空壳可本地跑通  
4. 会员小程序、商家小程序目录骨架就绪（微信原生 + TypeScript；可先占位页）  
5. CI（GitHub Actions）：安装依赖、lint/typecheck、Prisma validate、基础单测占位  
6. Prisma schema 落地关键实体（可先无业务 API，仅模型 + 迁移）  
7. 配置项 **`esign.production.enabled` 骨架**：默认 `false`，可读配置、可在健康/配置接口或日志中体现；**不得**在默认配置下走正式签署

### 非目标（本里程碑不做）

- 微信登录、开卡、账务、页面业务、e签宝真实联调  
- 正式 AppID / 企业主体 / 生产部署  
- 小程序内微信支付（全项目第一版都不做）  
- 助手或 Claude Code **未经坤总确认**直接 push / 合 main / 部署

---

## 1. 硬约束（必须遵守）

| 约束 | 说明 |
| --- | --- |
| 入职前无正式主体 / 无正式 AppID | 用微信**测试号**占位配置；AppID/Secret 只进 `.env`，不进仓 |
| e签宝 | 锁定；先沙箱；`esign.production.enabled` **默认关** |
| 充值/消费 | 仅线下记账展示；**禁止**引入微信支付 SDK / 支付回调 |
| 多门店 | 余额全公司通用（`wallet` 挂在会员，不按门店拆余额） |
| 公开仓文案 | README/注释用「储值会员」「会员权益」等通用名，**不得**出现具体项目/产品名 |
| 协作 | 实现：全栈云端写码开 PR；审代码：技术部；**合入/部署须坤总确认** |

开发部已定选型（相对技术部定稿的微调，以本说明为准）：

- 后端：**NestJS + Prisma + PostgreSQL**（定稿曾写 MySQL，现统一 PostgreSQL）  
- 商家后台：**Vue3 + Vite + Ant Design Vue**  
- 小程序：**微信原生 + TypeScript**（会员端 `apps/member-mp`，商家端 `apps/staff-mp`）  
- 电子签：**e签宝**（本里程碑只做开关与配置骨架）

---

## 2. 建议仓库结构

```text
prepaid-member-miniprogram/
├── README.md                 # 通用描述 + 本地启动；无具体项目名
├── .gitignore
├── .env.example              # 全量环境变量样例（无真实密钥）
├── package.json              # pnpm workspace 根（或 npm workspaces）
├── pnpm-workspace.yaml
├── turbo.json                # 可选：若用 Turborepo
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md       # 简短架构与模块边界
│   └── esign-switch.md       # esign.production.enabled 说明
├── packages/
│   └── shared/               # 可选：共享类型、常量、zod schema
├── apps/
│   ├── api/                  # NestJS
│   ├── admin-web/            # Vue3 商家后台
│   ├── member-mp/            # 会员微信小程序
│   └── staff-mp/             # 商家微信小程序
└── docker-compose.yml        # 本地 PostgreSQL（+ 可选 MinIO 占位）
```

包管理优先 **pnpm**；若坤总环境不便，可用 npm workspaces，但需在 README 写清。

---

## 3. 环境变量骨架（`.env.example`）

至少包含（值全为占位）：

```bash
# App
NODE_ENV=development
API_PORT=3000

# Database
DATABASE_URL=postgresql://prepaid:prepaid@localhost:5432/prepaid_member?schema=public

# Auth（M1 会用；M0 先占位）
JWT_SECRET=change-me-in-local-only

# Redis（可选；暂不用可留空）
REDIS_URL=

# WeChat — 测试号（入职前）；与技术部约定名一致，亦兼容 WECHAT_* 别名
WECHAT_MEMBER_APPID=
WECHAT_MEMBER_SECRET=
WECHAT_STAFF_APPID=
WECHAT_STAFF_SECRET=

# e签宝 — 沙箱
ESIGN_APP_ID=
ESIGN_APP_SECRET=
ESIGN_API_HOST=https://smlopenapi.esign.cn
# 正式签署总开关：默认 false；true 仅在 12 月主体+企业章就绪后由运维打开
# 配置项名 esign.production.enabled ↔ 环境变量 ESIGN_PRODUCTION_ENABLED
ESIGN_PRODUCTION_ENABLED=false

# Object storage（合同 PDF；M0 可先本地目录或 MinIO 占位）
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

Nest 配置模块须把 `ESIGN_PRODUCTION_ENABLED` 解析为布尔，并在应用启动日志打印：`esign.production.enabled=false`（或当前值）。提供只读配置查询（如 `GET /health` 或 `GET /internal/config` 脱敏字段）中带上该开关。

**开关语义（技术部定稿）：** `false` 时所有签署相关调用只能打沙箱；`true` 才允许正式密钥/计费/对外正式签署。M0 **不必**接通 e签宝真实 API（属 M4），但必须有配置读取 + 服务内校验骨架（例如 `EsignGuard` / `EsignConfigService.assertSandboxUnlessEnabled()`），并附 **最少 1 个单测** 验证默认 false。

---

## 4. Prisma 数据模型（M0 必须落库）

按技术部定稿实体落地；字段可微调，但表/关系不可缺。金额统一用 **整数分（cent）**；时间用 `timestamptz`。

建议模型（命名可 snake_case 映射）：

1. **Org** — id, name, status, createdAt, updatedAt  
2. **Store** — id, orgId, name, status, address?, createdAt, updatedAt  
3. **Staff** — id, orgId, phone, name, status, wxOpenId?, createdAt, updatedAt  
4. **StaffStoreRole** — id, staffId, storeId, role(`SUPER_ADMIN`|`STORE_MANAGER`|`STAFF`), unique(staffId, storeId)  
5. **Member** — id, orgId, phone, wxOpenId?, wxUnionId?, openStoreId?, status, createdAt, updatedAt；unique(orgId, phone)  
6. **Wallet** — id, memberId unique, balanceCent Int default 0, version Int default 0（乐观锁）, updatedAt  
7. **LedgerEntry** — id, orgId, memberId, walletId, storeId, operatorStaffId?, type(`RECHARGE`|`CONSUME`|`REVERSAL`), amountCent, balanceBefore, balanceAfter, remark?, createdAt；**禁止硬删**  
8. **BenefitPlan** — id, orgId, title, contentJson?, status, createdAt, updatedAt  
9. **ContractTemplate** — id, orgId, benefitPlanId?, esignTemplateId, name, status  
10. **SignFlow** — id, orgId, memberId, templateId, esignFlowId?, status, signUrl?, pdfObjectKey?, env(`SANDBOX`|`PRODUCTION`), createdAt, updatedAt  
11. **AuditLog** — id, orgId, actorStaffId?, action, targetType?, targetId?, payloadJson?, createdAt  

M0 验收：`prisma migrate dev` 成功；生成 client；可选 seed：1 个 org + 1 store + 1 staff（超管）。

**账务原则（写进 schema 注释 / docs）：** 任何余额变更必须写 `LedgerEntry`；扣款前校验余额；事务 + `version` 乐观锁。业务 API 留给 M1/M2。

---

## 5. 后端 `apps/api`（NestJS）最小集

- 模块：`ConfigModule`、`PrismaModule`、`HealthModule`、`EsignConfigModule`（仅开关与配置读取）  
- **空模块边界注释**（方便 M1 接入，本里程碑无业务实现）：`AuthModule` / `OrgModule` / `WalletModule` / `EsignModule` 目录 + `TODO(M1|M2|M4)`  
- 角色枚举预留：`SUPER_ADMIN` / `STORE_MANAGER` / `STAFF`（实现属 M1）  
- `GET /health` → `{ ok: true, esignProductionEnabled: false, db: "up"|"down" }`  
- 全局校验（class-validator 或 zod）、统一异常过滤器占位  
- 不实现登录/账务/e签宝真实调用（可留空注释）  
- `docker-compose.yml` 起 PostgreSQL；README 写 `pnpm --filter api start:dev`  
- **单测：** Feature flag 默认 false 的最小验证（必做）

---

## 6. 前端骨架

### `apps/admin-web`（Vue3 + Vite + Ant Design Vue）

- 路由：登录页占位、布局壳、Dashboard 占位  
- axios/fetch 封装指向 `VITE_API_BASE`  
- 环境：`.env.development` 示例

### `apps/member-mp` / `apps/staff-mp`

- `project.config.json` / `app.json` / TypeScript 基础页：「首页」「我的」占位  
- README 说明：用微信开发者工具打开对应目录；AppID 填测试号  
- **不要**接入支付相关插件

---

## 7. CI（GitHub Actions）

触发：`push` / `pull_request` → `main`

Job 建议：

1. checkout + setup pnpm + Node 20  
2. `pnpm install`  
3. `pnpm -r lint` 与/或 `typecheck`（各 app 有脚本即可）  
4. 对 api：`prisma validate` + `prisma generate`（可用 ephemeral Postgres service 或仅 validate）  
5. 可选：`pnpm --filter api test`（最少 1 个 health 单测）

公开仓：CI 日志勿打印密钥。

---

## 8. 文档与仓规范

README 须含：

- 项目一句话（储值会员 · 线下记账 + 线上权益/签署）  
- 本地启动步骤（compose、migrate、api、admin、小程序）  
- 协作：实现经坤总确认后推送；PR 请技术部 Code Review  
- **禁止事项**：微信支付；默认打开正式签署；把密钥提交进仓  

另写 `docs/esign-switch.md`：说明沙箱 vs 正式、`ESIGN_PRODUCTION_ENABLED`、12 月主体切换时运维步骤占位（详细切换属 M6）。

`.gitignore`：`.env`、`node_modules`、`dist`、小程序私有配置、IDE 文件等。

---

## 9. 验收清单（全栈审代码用）

- [ ] monorepo 可安装；`docker compose up -d` 后 DB 可用  
- [ ] `prisma migrate` + seed 成功；十一类核心实体齐  
- [ ] `GET /health` 正常，且 `esignProductionEnabled === false`  
- [ ] Feature flag 单测通过（默认 false）  
- [ ] auth/org/wallet/esign 空模块边界注释已就位  
- [ ] admin-web 本地可打开壳页  
- [ ] 两个小程序目录可在开发者工具打开（占位页即可）  
- [ ] CI 绿（或 PR 上可见）  
- [ ] README / `.env.example` / `docs/esign-switch.md` 齐全  
- [ ] 无微信支付依赖；无真实密钥进仓；公开文案无具体项目名  
- [ ] **未**在未获坤总确认时 force-push / 直接改保护分支（若需首推，由坤总确认后推送）

---

## 10. 提交节奏（全栈执行）

1. 云端写码按本说明落地到分支（建议 `chore/m0-bootstrap`）  
2. 自测验收清单  
3. 开 PR 到 `main`，把 PR 链接交开发部 → 总经理转坤总确认  
4. **坤总确认前不 merge、不部署**；技术部 Code Review  
5. M0 合并后通知开发部 → 后端可开 M1

---

## 11. 实现任务摘要（全栈 / 云端写码）

在空仓库 https://github.com/2770419748-lgtm/prepaid-member-miniprogram 搭建 pnpm monorepo：NestJS+Prisma+PostgreSQL API、Vue3+Ant Design Vue 商家后台壳、两个微信原生 TS 小程序占位、docker-compose Postgres、GitHub Actions CI、完整 Prisma 模型（Org/Store/Staff/StaffStoreRole/Member/Wallet/LedgerEntry/BenefitPlan/ContractTemplate/SignFlow/AuditLog）、环境变量与 `ESIGN_PRODUCTION_ENABLED` 默认 false 的配置骨架。禁止微信支付；密钥不进仓；README 用通用「储值会员」描述。按 docs 与验收清单自测；不要 force-push；开 PR 后等坤总确认再合 main。

