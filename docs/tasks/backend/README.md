# 储值会员小程序 — 后端实现说明（后端开发直接实现）

> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram（**当前空仓**；等全栈 M0 PR 经坤总确认合入）  
> **选型：** NestJS + Prisma + PostgreSQL · 落点 `apps/api`  
> **电子签：** e签宝；`ESIGN_PRODUCTION_ENABLED` / `esign.production.enabled` **默认 false**  
> **协作（本目录统一）：**  
> - **实现方：后端开发（本助手）** 用 Cursor **云端写码（Cloud Agent）** 改仓  
> - **不交给 Claude Code**  
> - **每阶段开 PR**；PR 链接交 **开发部 → 总经理 → 请坤总确认** 后再合入  
> - **禁止**自行 merge / 部署 / 改生产  
> - 公开内容不得出现具体项目名；称呼**坤总**  
> **硬约束对齐：** `docs/tech/tech-final.md` · `docs/tasks/m0-kickoff.md`（实体 / 枚举 / env / 仓结构以 M0 为准）

---

## 1. 当前状态（待命）

**全员已覆盖暂停、现按开工指令待命：** 等全栈 **M0 PR 经坤总确认合入** 后，后端立刻开 **M1 → M2**，其后 **M4** 与 **P2 审计**（审计可与 M4 并行）。  
当前仓库仍为空仓时：**只改本目录说明，不改 GitHub 仓。**

---

## 2. 本目录文件

| 文件 | 路径 | 人天 | 依赖 |
| --- | --- | --- | --- |
| README（本文件） | `docs/tasks/backend/README.md` | — | — |
| M1 账号门店 | `docs/tasks/backend/m1-auth-stores.md` | 约 6 | M0 |
| M2 账务 | `docs/tasks/backend/m2-ledger.md` | 约 10 | M1 |
| M4 e签宝沙箱 | `docs/tasks/backend/m4-esign-sandbox.md` | 约 10 | M2；企业章正式能力等 M6 |
| P2 审计对账 | `docs/tasks/backend/p2-audit.md` | 约 4 | M2 |

---

## 3. 依赖顺序

```
M0（全栈 · 须坤总确认合入） → M1 账号门店 → M2 账务 → ┬→ M4 e签宝沙箱
                                                      └→ P2 审计对账（可与 M4 并行）
```

- **M0 期望：** 仓结构、Prisma 十一类实体初稿、`.env.example`、CI、`ESIGN_PRODUCTION_ENABLED=false`、测试号 `WECHAT_*` 占位、JWT_SECRET、DATABASE_URL。  
- **当前空仓：** 各说明写「等 M0 落地后在现有 schema 上扩展；若冲突以能支撑下列实体与开关为准」。  
- **冲突：** 与 M0 schema 冲突时对齐后告知技术部。

---

## 4. 仓结构（对齐 M0）

```text
apps/api          # NestJS 后端（本目录任务全部落在此）
apps/admin-web    # Vue3 商家后台
apps/member-mp    # 会员小程序
apps/staff-mp     # 商家小程序
```

---

## 5. 实体 / 枚举 / Env（必须与 M0 一致）

**实体：** Org, Store, Staff, StaffStoreRole, Member, Wallet, LedgerEntry, BenefitPlan, ContractTemplate, SignFlow, AuditLog  

| 枚举 | 取值 |
| --- | --- |
| StaffStoreRole.role | `SUPER_ADMIN` \| `STORE_MANAGER` \| `STAFF` |
| LedgerEntry.type | `RECHARGE` \| `CONSUME` \| `REVERSAL` |
| SignFlow.env | `SANDBOX` \| `PRODUCTION` |

- 金额：**整数分** `balanceCent` / `amountCent`（及流水 `balanceBefore` / `balanceAfter`）  
- 乐观锁：`Wallet.version`  
- Env 关键：`WECHAT_*`、`ESIGN_PRODUCTION_ENABLED`、`JWT_SECRET`、`DATABASE_URL`

---

## 6. 权限矩阵（全模块共用）

| 角色 | 范围 |
| --- | --- |
| `SUPER_ADMIN` | 全部门店与账号 |
| `STORE_MANAGER` | 本店 + 下属店员 |
| `STAFF` | 本店开卡 / 记账 / 查询 |
| 会员端 | 仅看自己的权益 / 余额 / 明细 / 门店 / 签署 |

- 店员操作**记门店**（`storeId`）；余额**不按门店隔离**（公司通用，挂在 `Wallet`）。

---

## 7. 硬约束

1. 入职前微信**测试号**；正式 AppID 12 月后切换。  
2. 电子签仅沙箱；`ESIGN_PRODUCTION_ENABLED=false`；入职前不可开正式签署。  
3. **禁止**小程序内微信支付 / 支付回调入账。  
4. 流水不可物理删；余额变更必须事务内写 `LedgerEntry` + `Wallet.version` 乐观锁。  
5. **后端直接实现**；每阶段开 PR，**合入与部署须坤总确认**；禁止自行 merge / 部署 / 改生产。

---

## 8. 后端直接实现与 PR 流程

1. 确认全栈 **M0 PR 已经坤总确认合入**（或至少 schema + env 可用）。  
2. **一次只做一个里程碑**（先 M1，再 M2，再 M4 / P2）。  
3. 用 Cursor **云端写码（Cloud Agent）** 在 `apps/api` 按对应 md 实现。  
4. 自检通过后开 PR（勿 merge），将 **PR 链接交开发部**，由开发部转总经理请**坤总确认**后再合入。  
5. **禁止**自行 merge / 部署 / 改生产；公开文案无具体项目名。

建议分支名：`feat/m1-auth-stores`、`feat/m2-wallet-ledger`、`feat/m4-esign-sandbox`、`feat/p2-audit-reconciliation`。

---

## 9. 风格参考

前端说明目录：`docs/tasks/frontend/`（结构可对照；后端以本目录与 M0 为准）。
