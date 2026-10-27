# M1 · 账号与门店 — 后端实现说明

> **协作：** 实现方为**后端开发（本助手）**，用 Cursor **云端写码（Cloud Agent）** 改仓；**不交给 Claude Code**。每阶段开 PR，链接交 **开发部 → 总经理 → 请坤总确认** 后再合入；**禁止**自行 merge / 部署 / 改生产。公开内容不得出现具体项目名；称呼**坤总**。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram（空仓；等 M0 经坤总确认合入后在 `apps/api` 扩展）  
> **落点：** `apps/api`（NestJS + Prisma + PostgreSQL）  
> **预估：** 约 6 人天 · **依赖 M0**  
> **硬约束对齐：** `docs/tech/tech-final.md` · `docs/tasks/m0-kickoff.md`（定稿第 3.1 / 6–8 节）

---

## 1. 目标与非目标

### 目标

1. 微信**测试号**手机号授权登录（会员端 + 店员端可分 AppId）  
2. 区分**会员**与**店员**身份；店员走 `Staff` + `StaffStoreRole`  
3. 落地组织域：`Org` / `Store` / `Staff` / `StaffStoreRole` 的管理 API  
4. 角色鉴权：`SUPER_ADMIN` | `STORE_MANAGER` | `STAFF`；门店数据隔离（操作记门店；余额公司通用留给 M2）  
5. JWT 签发 / 校验；守卫与角色装饰器可复用到后续模块

### 非目标

- 开卡、充值、扣款、流水（→ M2）  
- e签宝真实联调（→ M4）  
- 审计日志完整实现（→ P2；本里程碑可预留写点注释）  
- 正式 AppID / 生产部署 / 微信支付  
- 自行 merge / 部署 / 改生产（须坤总确认）

---

## 2. 前置依赖（M0）

等 M0 落地后在现有 schema 上扩展；若冲突以能支撑下列实体与开关为准。

M0 应已具备：

- [ ] monorepo：`apps/api`、`apps/admin-web`、`apps/member-mp`、`apps/staff-mp`  
- [ ] Prisma 十一类实体初稿（含 Org/Store/Staff/StaffStoreRole/Member）  
- [ ] `.env.example`：`DATABASE_URL`、`JWT_SECRET`、`WECHAT_*`、`ESIGN_PRODUCTION_ENABLED=false`  
- [ ] CI、`GET /health`、空模块边界 `AuthModule` / `OrgModule` 注释  
- [ ] seed：1 Org + 1 Store + 1 Staff（超管）可选

开工前：确认全栈 M0 PR **已经坤总确认合入**；本地 `prisma migrate` / `generate` 成功。

---

## 3. 数据模型要点（字段可微调，关系与枚举不可缺）

对齐 M0；下列为建议字段（**可调**已标）。

### Org

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| id | cuid/uuid | PK |
| name | string | 公司名 |
| status | enum/string | ACTIVE / DISABLED（可调） |
| createdAt / updatedAt | timestamptz | |

### Store

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| id | | PK |
| orgId | FK → Org | |
| name | string | |
| status | | ACTIVE / DISABLED（可调） |
| address | string? | 可调 |
| createdAt / updatedAt | | |

### Staff

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| id | | PK |
| orgId | FK → Org | |
| phone | string | 登录关联 |
| name | string | |
| status | | ACTIVE / DISABLED |
| wxOpenId | string? | 店员小程序 openid（可调） |
| createdAt / updatedAt | | |

建议：`@@unique([orgId, phone])`（可调，但需能按手机号找店员）。

### StaffStoreRole

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| id | | PK |
| staffId | FK → Staff | |
| storeId | FK → Store | |
| role | enum | **`SUPER_ADMIN` \| `STORE_MANAGER` \| `STAFF`** |
| | | `@@unique([staffId, storeId])` |

> 超管可约定：绑定任意一店 + `SUPER_ADMIN`，鉴权时忽略 store 限制；或单独 org 级标记（实现二选一，文档写清）。

### Member（M1 登录会读写；开卡细节属 M2）

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| id | | PK |
| orgId | FK | |
| phone | string | **必填**；`@@unique([orgId, phone])` |
| wxOpenId / wxUnionId | string? | 微信标识 |
| openStoreId | FK? → Store | 开卡门店（开卡时写，M2；登录可空） |
| status | | ACTIVE / DISABLED 等 |
| createdAt / updatedAt | | |

---

## 4. 权限矩阵

| 角色 | 门店范围 | 账号 | 本模块能力 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | 全部门店 | 全公司账号 | 门店 CRUD、店员分配任意店、查全部 |
| `STORE_MANAGER` | 本店 + 下属 | 本店店员 | 本店店员管理；不可跨店 |
| `STAFF` | 本店 | — | 只读本店信息（开卡/记账在 M2） |
| 会员端 | — | 仅自己 | 登录、读自己资料；不可访店员 API |

- 店员操作一律带 `storeId`（后续账务记门店）。  
- 余额不按门店隔离（M2）；本模块只需保证角色守卫正确。

---

## 5. API 清单

> 路径前缀建议 `/api/v1`；最终以仓内全局前缀为准。金额本模块不涉及。

### 5.1 认证

| 方法 | 路径 | 鉴权 | 请求要点 | 响应要点 |
| --- | --- | --- | --- | --- |
| POST | `/auth/member/wx-phone` | 无 | `code`（wx.login）+ 手机号授权 `phoneCode`（或文档约定字段）；标识会员端 `WECHAT_MEMBER_*` | JWT + member 摘要；若无 Member 则**仅登录会话**或返回需开卡标记（开卡属 M2，勿在此写余额） |
| POST | `/auth/staff/wx-phone` | 无 | 同上，用 `WECHAT_STAFF_*`；手机号须已存在于 `Staff` 且 ACTIVE | JWT + staff + roles[]（含 storeId, role） |
| GET | `/auth/me` | 登录 | — | 当前身份：member 或 staff+roles |

说明：测试号阶段按微信开放文档换 session / 手机号；密钥只读 env，不进仓。

### 5.2 门店（店员 JWT）

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/stores` | 超管：全部；店长/店员：本店列表 | 分页可选 |
| POST | `/stores` | `SUPER_ADMIN` | 创建门店 |
| PATCH | `/stores/:id` | `SUPER_ADMIN`（店长改本店基础信息可调） | 更新 |
| GET | `/stores/:id` | 有权访问该店 | 详情 |

### 5.3 店员与角色

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/staff` | 超管全公司；店长本店 | 列表 |
| POST | `/staff` | 超管；店长可建本店 `STAFF`（可调） | body: phone, name, storeId, role |
| PATCH | `/staff/:id` | 超管 / 本店店长 | 停用、改名等 |
| PUT | `/staff/:id/roles` | 超管；店长限本店且不可赋超管 | 设置 `StaffStoreRole` |
| GET | `/staff/me/stores` | 任意店员 | 当前账号可操作门店 |

### 5.4 会员只读（可选本里程碑）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/members/me` | 会员 JWT | 自己的资料（无余额字段或占位 0，余额以 M2 为准） |

---

## 6. 业务规则与硬约束

1. **登录 = 微信授权手机号**（测试号）；禁止伪造手机号后门进生产路径（本地 dev mock 须用独立开关且默认关）。  
2. 店员登录：手机号必须已在 `Staff` 中；未录入店员不可登录后台/商家小程序。  
3. 会员登录：可先建/更新 `Member` 的微信标识与手机号；**开卡状态 / 余额**由 M2 店员录入流程定义（本模块勿实现充值）。  
4. JWT 载荷建议：`sub`, `orgId`, `principalType: MEMBER|STAFF`, `roles?: {storeId, role}[]`。  
5. 数据隔离：非超管查询必须按 `storeId ∈ token.roles` 过滤。  
6. 密钥：`WECHAT_*`、`JWT_SECRET` 仅 env；公开文案无具体项目名。  
7. **禁止**引入微信支付 SDK。

---

## 7. 云端开 PR 验收清单

- [ ] 会员测试号手机号登录成功，返回 JWT；`GET /auth/me` 为会员  
- [ ] 店员测试号登录成功；未录入 Staff 的手机号被拒绝  
- [ ] seed 超管可创建门店、分配 `STORE_MANAGER` / `STAFF`  
- [ ] 店长只能看到/管理本店；跨店返回 403  
- [ ] 店员不能调用超管专属接口  
- [ ] 会员 JWT 访问店员 API 返回 403  
- [ ] 角色枚举值为 `SUPER_ADMIN` | `STORE_MANAGER` | `STAFF`（与 M0 一致）  
- [ ] 无真实密钥进仓；无微信支付依赖  
- [ ] 单测或 e2e：至少覆盖「角色守卫拒绝跨店」与「店员登录校验」  
- [ ] 已开 PR（建议 `feat/m1-auth-stores`），**未自行 merge**；PR 链接已交开发部请坤总确认

---

## 8. 测试建议

- 单元：JwtStrategy 载荷解析；RolesGuard 矩阵表驱动  
- 集成：Prisma + 测试库；创建 org/store/staff 后打登录与列表接口  
- Mock：微信 code2session / 手机号接口用 http mock，勿打真实网  
- 回归：改 schema 后 `prisma validate` + CI 绿

---

## 9. 后端直接实现步骤

1. 确认 M0 schema / env / 空 `AuthModule`/`OrgModule` 位置（M0 已合入）  
2. 补齐枚举与索引（若 M0 已齐则跳过）；`prisma migrate`  
3. 实现微信手机号换取服务（Member / Staff 两套 config）  
4. JWT 模块 + 登录两个 endpoint + `/auth/me`  
5. Guards：`JwtAuthGuard`、`RolesGuard`、可选 `@StoreScope()`  
6. Stores CRUD（按角色过滤）  
7. Staff + StaffStoreRole 管理 API  
8. 写单测；更新 `docs` 简短说明登录流（无具体项目名）  
9. 自检验收清单 → 用 Cloud Agent 开 PR → **PR 链接交开发部，等坤总确认后再合入**（禁止自行 merge / 部署）

---

## 10. 合入须坤总确认

实现与自测通过后：列出变更文件与验收勾选结果，开 PR（如 `feat/m1-auth-stores`），**不要 force-push / 自行合 main / 部署**。将 PR 链接交开发部，由开发部转总经理请**坤总确认**后再合入。
