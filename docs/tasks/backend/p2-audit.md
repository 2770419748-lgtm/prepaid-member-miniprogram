# P2 · 审计与对账 — 后端实现说明

> **协作：** 实现方为**后端开发（本助手）**，用 Cursor **云端写码（Cloud Agent）** 改仓；**不交给 Claude Code**。每阶段开 PR，链接交 **开发部 → 总经理 → 请坤总确认** 后再合入；**禁止**自行 merge / 部署 / 改生产。公开内容不得出现具体项目名；称呼**坤总**。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **仓库：** https://github.com/2770419748-lgtm/prepaid-member-miniprogram  
> **落点：** `apps/api` · 建议 `AuditModule`  
> **预估：** 约 4 人天 · **依赖 M2**（可与 M4 并行）  
> **硬约束对齐：** `docs/tech/tech-final.md` · `docs/tasks/m0-kickoff.md`（定稿第 6.1 审计 · M0 `AuditLog` 实体）

---

## 1. 目标与非目标

### 目标

1. **操作日志 `AuditLog`**：至少覆盖 **开卡 / 充值 / 扣款 / 发起签署**  
2. **当日对账视图**：按门店汇总当日充值 / 消费（及笔数）；供后台看板  
3. 查询 API + 权限控制；日志只追加不删

### 非目标

- 完整财务报表、税务、导出 Excel（若做导出列为可选加分，非必须）  
- 短信通知  
- 修改历史流水（对账只读聚合 `LedgerEntry`）  
- 自行 merge / 部署 / 改生产（须坤总确认）

---

## 2. 前置依赖

等 M0 落地后在现有 schema 上扩展；若冲突以能支撑下列实体与开关为准。

- [ ] M0：`AuditLog` 表已存在  
- [ ] M1：店员身份与角色  
- [ ] M2：开卡 / 充值 / 扣款已实现（在成功路径打点；M2 已合入）  
- [ ] M4（并行时）：发起签署成功路径打点；若 M4 未合，先留 hook，M4 合并时接上

---

## 3. 数据模型要点

### AuditLog（M0）

| 字段 | 说明 |
| --- | --- |
| id | PK |
| orgId | |
| actorStaffId | 操作店员；系统回调可空 |
| action | 字符串或枚举建议：`MEMBER_OPEN` / `WALLET_RECHARGE` / `WALLET_CONSUME` / `SIGN_FLOW_CREATE`（可调，需稳定） |
| targetType | 如 `Member` / `Wallet` / `SignFlow` |
| targetId | |
| payloadJson | 脱敏快照：金额分、storeId、remark 等；**勿存密钥** |
| createdAt | |

可选索引：`(orgId, createdAt)`、`(orgId, action, createdAt)`、`(actorStaffId, createdAt)`。

**禁止**物理删除 AuditLog；不做 update 业务接口。

---

## 4. 权限矩阵

| 角色 | 审计日志 | 当日对账 |
| --- | --- | --- |
| `SUPER_ADMIN` | 全公司 | 全部门店 |
| `STORE_MANAGER` | 本店相关（actor 本店或 target 本店，约定一种并写清） | 本店 |
| `STAFF` | 仅自己操作记录（可调：或本店只读） | 本店只读汇总 |
| 会员 | 无 | 无 |

---

## 5. API 清单

| 方法 | 路径 | 鉴权 | 请求/响应要点 |
| --- | --- | --- | --- |
| GET | `/audit-logs` | 店员按角色 | 筛选：action、actorStaffId、storeId（从 payload 或冗余列）、时间范围、分页 |
| GET | `/audit-logs/:id` | 有权 | 详情 |
| GET | `/reconciliation/daily` | 店员按角色 | query: `date=YYYY-MM-DD`（默认当天 Asia/Shanghai）、`storeId?`；响应按门店：`rechargeCent`、`consumeCent`、`rechargeCount`、`consumeCount`（冲正可单列或计入净额——建议**单列 reversalCent**） |

对账数据来源：聚合当日 `LedgerEntry`（按 `createdAt` 落在上海时区当日 + `storeId` + `type`），**不是**改余额。

---

## 6. 业务规则与硬约束

1. 在 M2/M4 **成功提交事务之后**（或同一事务末尾）写入 AuditLog；失败操作可不记或记 FAILURE（本版建议：**仅成功必记**）。  
2. 开卡 / 充值 / 扣款 / 发起签署 **四类 action 必有**。  
3. `payloadJson` 含 `storeId`、`amountCent`（若有）、`memberId`，便于审计；手机号可掩码。  
4. 对账只读；发现问题走 M2 冲正流程，不在此改数。  
5. 时区：**Asia/Shanghai** 定义「当日」。

---

## 7. 云端开 PR 验收清单

- [ ] 开卡成功产生 `MEMBER_OPEN`（或约定名）审计一条  
- [ ] 充值 / 扣款成功各一条，金额与 storeId 可查  
- [ ] 发起签署成功一条（M4 就绪后）  
- [ ] 无删除审计 API  
- [ ] `GET /reconciliation/daily` 按门店汇总与当日流水一致  
- [ ] 店长不能看超管限定的跨店数据（按矩阵）  
- [ ] 会员调用审计/对账接口 403  
- [ ] 已开 PR（建议 `feat/p2-audit-reconciliation`），**未自行 merge**；PR 链接已交开发部请坤总确认

---

## 8. 测试建议

- 集成：开卡→充值→扣款后审计 3 条；对账充值/消费汇总等于流水之和  
- 时区边界：23:30 / 00:30 跨日用例一条  
- 权限：STAFF / STORE_MANAGER / SUPER_ADMIN 各一

---

## 9. 后端直接实现步骤

1. 确认 `AuditLog` schema；补索引与 action 常量  
2. 实现 `AuditService.record`（唯一写入入口）  
3. 在开卡 / 充值 / 扣款服务成功路径接入  
4. （可选当下）SignFlow 创建处预留调用  
5. 审计查询 API  
6. 当日对账聚合 API（SQL 或 Prisma groupBy）  
7. 测试 → 自检 → 用 Cloud Agent 开 PR → **PR 链接交开发部，等坤总确认后再合入**（禁止自行 merge / 部署）

---

## 10. 合入须坤总确认

开 PR（如 `feat/p2-audit-reconciliation`）；附对账样例响应；将 PR 链接交开发部，由开发部转总经理请**坤总确认**后再合入。禁止自行 merge / 部署 / 改生产。
