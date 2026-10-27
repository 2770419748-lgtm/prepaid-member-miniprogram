# M2 · 账务 — 后端实现说明

> **协作：** 实现方为**后端开发（本助手）**，用 Cursor **云端写码（Cloud Agent）** 改仓；**不交给 Claude Code**。每阶段开 PR，链接交 **开发部 → 总经理 → 请坤总确认** 后再合入；**禁止**自行 merge / 部署 / 改生产。公开内容不得出现具体项目名；称呼**坤总**。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram（等 M0/M1 经坤总确认合入后在 `apps/api` 扩展）  
> **落点：** `apps/api` · 建议模块 `WalletModule` / `MemberModule`  
> **预估：** 约 10 人天 · **依赖 M1**  
> **硬约束对齐：** `docs/tech/tech-final.md` · `docs/tasks/m0-kickoff.md`（定稿第 6 节账务原则）

---

## 1. 目标与非目标

### 目标

1. **开卡**：店员录入手机号等，创建/激活 `Member`，并确保一人一 `Wallet`  
2. **公司通用余额**：`Wallet` 挂会员，不按门店拆余额  
3. **记账**：充值 `RECHARGE`、消费 `CONSUME`；预留冲正 `REVERSAL` 占位（可最小实现或仅枚举+禁止入口）  
4. 任何余额变更：**事务内**写 `LedgerEntry`；扣款前校验余额；`Wallet.version` **乐观锁**防超卖  
5. **禁止微信支付**；只接受后台 / 店员录入的记账请求  
6. 会员/店员可查余额与流水（权限按矩阵）

### 非目标

- 赠送金、有效期、跨店复杂冲正规则（开放项 O3，非本里程碑必做）  
- e签宝（→ M4）  
- 完整审计导出 / 财务报表（→ P2 做操作日志与当日对账）  
- 微信支付、支付回调、退款进微信  
- 自行 merge / 部署 / 改生产（须坤总确认）

---

## 2. 前置依赖

等 M0 落地后在现有 schema 上扩展；若冲突以能支撑下列实体与开关为准。

- [ ] M0：Prisma 含 `Member` / `Wallet` / `LedgerEntry`；金额字段为整数分  
- [ ] M1：店员 JWT + 角色守卫 + 门店范围可用（M1 PR 已经坤总确认合入）  
- [ ] env：`DATABASE_URL`、`JWT_SECRET`；无支付相关 env

---

## 3. 数据模型要点

### Member（开卡写入）

| 字段 | 说明 |
| --- | --- |
| phone | 店员录入；`@@unique([orgId, phone])` |
| wxOpenId / wxUnionId | 会员登录后回写（可空） |
| openStoreId | **开卡门店**；记操作门店 |
| status | 如 ACTIVE / DISABLED（可调） |

### Wallet

| 字段 | 说明 |
| --- | --- |
| memberId | **unique**；一人一钱包 |
| balanceCent | Int，默认 0；**整数分** |
| version | Int，默认 0；**乐观锁** |
| updatedAt | |

### LedgerEntry（不可物理删）

| 字段 | 说明 |
| --- | --- |
| orgId / memberId / walletId | 关联 |
| storeId | **操作门店**（必填） |
| operatorStaffId | 操作店员（必填，系统任务可空——本版店员录入必填） |
| type | **`RECHARGE` \| `CONSUME` \| `REVERSAL`** |
| amountCent | Int；建议**正整数**，方向由 type 决定（可调：或带符号，二选一并写清） |
| balanceBefore / balanceAfter | Int 分 |
| remark | string? |
| createdAt | 只增 |
| | **禁止** `DELETE` API / Prisma 硬删；纠错走 `REVERSAL` |

Schema 注释写明：余额变更必须写流水；事务 + version。

---

## 4. 权限矩阵（本模块）

| 角色 | 开卡 | 充值/扣款 | 查流水/余额 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | 任意店（请求仍带 storeId） | 任意店 | 全公司 |
| `STORE_MANAGER` | 本店 | 本店 | 本店操作视角；余额仍是会员总余额 |
| `STAFF` | 本店 | 本店 | 本店相关查询 |
| 会员 | 否 | 否 | **仅自己**的余额与明细 |

---

## 5. API 清单

金额单位：**分（cent）**。请求/响应字段名建议 `amountCent` / `balanceCent`。

| 方法 | 路径 | 鉴权 | 请求要点 | 响应要点 |
| --- | --- | --- | --- | --- |
| POST | `/members/open` | 店员 `STAFF+` | `phone`, `name?`, `storeId`（须在权限内）, `remark?` | member + wallet（balanceCent=0）；已存在 ACTIVE 则 409 或返回已有（约定一种） |
| GET | `/members` | 店员 | 查询：phone/keyword、分页；非超管限本店开卡或本店有流水（可调，写清） | 列表 |
| GET | `/members/:id` | 店员有权 / 或会员本人 | — | 资料 + balanceCent |
| GET | `/members/me/wallet` | 会员 | — | balanceCent, version（version 可对前端省略） |
| POST | `/wallets/:memberId/recharge` | 店员 | `storeId`, `amountCent` (>0), `remark?` | 新余额 + ledgerId；乐观锁冲突 → 409 可重试 |
| POST | `/wallets/:memberId/consume` | 店员 | 同上 | 余额不足 → 400；成功写 `CONSUME` |
| POST | `/wallets/:memberId/reversal` | 超管或店长（可调） | `storeId`, `amountCent`, `relatedLedgerId?`, `remark` | **占位**：可先 501 或最小实现（反向加回/扣回 + type=REVERSAL）；须写流水 |
| GET | `/ledger` | 店员按范围；会员仅自己 | 筛选：memberId, storeId, type, 时间, 分页 | 条目列表（无删改） |
| GET | `/ledger/:id` | 有权 | — | 详情 |

**禁止：**

- 任何 `/pay` / 微信支付回调路由  
- 客户端直传 `balanceCent` 覆盖钱包  
- 物理删除流水

---

## 6. 业务规则与硬约束

1. **开卡**：店员录入手机号；写 `openStoreId`；同时创建 `Wallet(balanceCent=0, version=0)`（同事务）。  
2. **余额公司通用**：只按 `memberId` 持有；`storeId` 仅表示操作发生店。  
3. **充值 / 消费**：  
   ```
   BEGIN
     read Wallet where id=… 
     if CONSUME and balanceCent < amountCent → fail
     newBalance = ±
     UPDATE Wallet SET balanceCent=newBalance, version=version+1 WHERE id=… AND version=oldVersion
     if rows=0 → conflict retry/fail
     INSERT LedgerEntry(...)
   COMMIT
   ```  
4. `amountCent` 必须为正整数；零/负拒绝。  
5. 操作员、门店从 JWT + body 校验：`storeId` 必须在操作者角色范围内。  
6. **无微信支付**；不接受支付渠道字段作为入账依据。  
7. 流水只追加；冲正另开一条 `REVERSAL`，不改历史行。

---

## 7. 云端开 PR 验收清单

- [ ] 开卡后 Member + Wallet 同事务存在；重复开卡行为符合约定  
- [ ] 充值后 balanceCent 与流水 balanceAfter 一致，type=`RECHARGE`  
- [ ] 消费成功/余额不足分别正确；type=`CONSUME`  
- [ ] 并发两笔扣至透支：乐观锁下至多一笔成功，余额不为负  
- [ ] 流水无 DELETE 接口；DB 层无业务硬删  
- [ ] 店员跨店记账 403；会员只能看自己  
- [ ] 代码库无微信支付 SDK / 回调  
- [ ] 金额均为整数分字段名与 M0 一致  
- [ ] 单测覆盖：乐观锁冲突、余额不足、事务写流水  
- [ ] 已开 PR（建议 `feat/m2-wallet-ledger`），**未自行 merge**；PR 链接已交开发部请坤总确认

---

## 8. 测试建议

- 单测：WalletService 用 mock Prisma 测余额不足与 version 冲突  
- 集成：并行 `Promise.all` 两次 consume 同一钱包  
- 用例表：开卡 → 充 10000 分 → 扣 3000 → 查流水 2 条 → 余额 7000  
- 权限：STAFF 改其他 storeId 应失败

---

## 9. 后端直接实现步骤

1. 核对 M0 `Wallet`/`LedgerEntry` 字段与枚举；补迁移如需  
2. 实现 `WalletService.adjust`（唯一余额变更入口）  
3. 开卡 API（事务：Member + Wallet）  
4. recharge / consume API + DTO 校验  
5. ledger 查询 API + 会员 me 接口  
6. reversal 占位（501 或最小实现）  
7. 并发单测 + 权限测试  
8. 自检 → 用 Cloud Agent 开 PR → **PR 链接交开发部，等坤总确认后再合入**（禁止自行 merge / 部署）

---

## 10. 合入须坤总确认

开 PR（如 `feat/m2-wallet-ledger`），附验收勾选与并发测试说明；**勿自行合 main / 部署**。将 PR 链接交开发部，由开发部转总经理请**坤总确认**后再合入。
