# P2 · 审计与对账 — 后端说明

> **状态：** 已实现（`apps/api` 的 `AuditModule` 与 `ReconciliationModule`）。  
> **日期：** 2026-10-28（Asia/Shanghai）  
> **协作：** 2026-10-27 起坤总授权 Claude 端到端推进开发，测试与 CI 通过后自行合并。不部署、不接微信支付、不打开电子签正式开关。  
> **依赖：** M2 储值账本（`docs/backend/m2-ledger.md`）。公开文案只用「储值会员」。

---

## 1. 做了什么

| 能力 | 说明 |
| --- | --- |
| 操作记录 | 开卡、充值、扣款、冲正、门店和员工变更、改密码等关键操作都记一条：谁、在哪家店、对谁、做了什么、多少钱。记录只追加，改不了、删不掉 |
| 操作记录查询 | 按操作类型、操作人、门店、对象、时间筛选，分页 |
| 当日对账 | 按门店汇总某一天的充值、消费、冲正笔数和金额，算出实收储值和实际消费 |
| 余额日结 | 全公司储值余额：日初 + 当日净增 = 日末（仅超级管理员） |
| 余额核对 | 逐张卡核对余额和流水是否对得上，列出对不上的卡（仅超级管理员） |
| 后台概览 | 开卡数、全公司储值余额（仅超级管理员）、今日充值与消费 |

对账和核对都只读，不改任何账。发现记错走 M2 冲正。

## 2. 规则

1. **「当天」按北京时间**（Asia/Shanghai，固定 UTC+8）零点到次日零点。23:30 记的算当天，00:30 记的算第二天。
2. 操作记录和业务写入在**同一个事务**里：事情没做成就不会留下记录，做成了就一定有记录。只记成功的操作。
3. 操作记录**只追加**：没有修改、删除接口；数据库触发器也拒绝 `UPDATE` / `DELETE` / `TRUNCATE`（与流水相同）。
4. 操作记录带**发生门店**（`storeId`）：开卡、充值、扣款、冲正、新建员工、门店新建和修改。与门店无关的（改密码、员工角色调整、会员首次登录）为空。
5. 查询时会员和员工的**手机号打码**为 `138****0000`；门店联系电话本来就公开，不打码。
6. 冲正在对账里**单列，按方向拆开**：冲回的充值（余额减少）记 `reversedRechargeCent`，退回的消费（余额增加）记 `reversedConsumeCent`。
   - 实收储值 `netRechargeCent` = 充值 − 冲回的充值，即当天门店应该线下收到的储值款。
   - 实际消费 `netConsumeCent` = 消费 − 退回的消费。
   - 余额净变化 `netChangeCent` = 实收储值 − 实际消费。
7. 冲正流水记在原流水的门店名下（M2 规则），所以冲正计入原门店当天的对账。
8. 余额是全公司通用的，**日结和核对只按全公司做**，不按门店拆。

## 3. 权限

| 角色 | 操作记录 | 当日对账 / 概览 | 余额日结 / 核对 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | 全公司 | 全部门店；概览含全公司余额 | 可以 |
| `STORE_MANAGER` | 自己管的门店里发生的 + 自己做的 | 自己的门店；概览不含余额 | 不可以（403） |
| `STAFF` | 只看自己做的 | 自己的门店（只读汇总） | 不可以（403） |
| 会员 | 403 | 403 | 403 |

店长看不到别家店的记录：详情返回 404（不透露记录存在），筛别家店返回空。

## 4. 接口

所有金额单位为分。

### 操作记录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/audit-logs` | 查询。参数：`action`、`actorStaffId`、`storeId`、`targetType`、`targetId`、`from`、`to`（ISO 时间，`from` 含、`to` 不含）、`page`、`pageSize`（≤100）。按时间倒序 |
| GET | `/audit-logs/actions` | 操作类型和中文名，供筛选下拉 |
| GET | `/audit-logs/:id` | 详情。看不到的记录返回 404 |

一条记录：

```json
{
  "id": "…",
  "action": "WALLET_RECHARGE",
  "actionLabel": "充值",
  "actorStaffId": "…",
  "actorName": "李店员",
  "storeId": "…",
  "storeName": "旗舰店",
  "targetType": "LedgerEntry",
  "targetId": "…",
  "payload": { "memberId": "…", "storeId": "…", "amountCent": 100000, "balanceBefore": 0, "balanceAfter": 100000 },
  "createdAt": "2026-10-27T17:30:23.000Z"
}
```

操作类型（`action`）：

| 代码 | 中文名 | 对象 | 门店 |
| --- | --- | --- | --- |
| `MEMBER_CARD_OPEN` | 开卡 | Member | 开卡门店 |
| `WALLET_RECHARGE` | 充值 | LedgerEntry | 记账门店 |
| `WALLET_CONSUME` | 消费扣款 | LedgerEntry | 记账门店 |
| `WALLET_REVERSAL` | 冲正 | LedgerEntry | 原流水门店 |
| `SIGN_FLOW_CREATE` | 发起签署 | SignFlow | 发起门店（M4 接入） |
| `MEMBER_IDENTITY_CREATE` | 会员首次登录 | Member | 空 |
| `STORE_CREATE` / `STORE_UPDATE` | 新建 / 修改门店 | Store | 该门店 |
| `STAFF_CREATE` | 新建员工 | Staff | 分配的门店 |
| `STAFF_UPDATE` / `STAFF_ROLES_REPLACE` | 修改员工 / 调整角色 | Staff | 空 |
| `STAFF_PASSWORD_CHANGE` / `STAFF_PASSWORD_RESET` | 修改 / 重置密码 | Staff | 空 |

新增操作类型时，在 `apps/api/src/audit/audit-log.writer.ts` 的 `AuditAction` 和 `AuditActionLabel` 里一起加（类型检查会提醒漏写中文名）。写入统一走 `AuditLogWriter.write(tx, …)`，放在业务事务里；`payload` 不放密钥、密码、签署链接。

### 对账

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/reconciliation/daily` | 当日对账。参数：`date=YYYY-MM-DD`（不填为北京时间今天）、`storeId`（可选） |
| GET | `/reconciliation/overview` | 后台概览 |
| GET | `/reconciliation/check` | 余额核对，仅超级管理员 |

`GET /reconciliation/daily`：

```json
{
  "date": "2026-10-28",
  "timezone": "Asia/Shanghai",
  "from": "2026-10-27T16:00:00.000Z",
  "to": "2026-10-28T16:00:00.000Z",
  "stores": [
    {
      "storeId": "…", "storeName": "旗舰店", "storeStatus": "ACTIVE",
      "rechargeCount": 2, "rechargeCent": 120000,
      "consumeCount": 1, "consumeCent": 12800,
      "reversalCount": 1, "reversedRechargeCent": 20000, "reversedConsumeCent": 0,
      "netRechargeCent": 100000, "netConsumeCent": 12800, "netChangeCent": 87200
    }
  ],
  "total": { "…": "同上各项的合计" },
  "balance": { "openingCent": 0, "netChangeCent": 121800, "closingCent": 121800 }
}
```

- `stores` 列出范围内全部门店（包括当天没有流水的、已停用的），按建店先后排。
- `balance` 只有超级管理员、且不带 `storeId` 时给出，其余为 `null`。日初余额 = 当天零点前全部流水的加减之和（开卡时余额为 0）。

`GET /reconciliation/overview`：

```json
{
  "scope": "ORG",
  "cardCount": 2,
  "totalBalanceCent": 121800,
  "today": { "date": "2026-10-28", "rechargeCount": 3, "rechargeCent": 170000, "…": "同当日对账各项" }
}
```

- 超级管理员 `scope` 为 `ORG`，统计全公司；其他人为 `STORES`，统计自己的门店，`cardCount` 按开卡门店算，`totalBalanceCent` 为 `null`（后台隐藏这一项）。

`GET /reconciliation/check`：

```json
{
  "checkedAt": "…",
  "ok": true,
  "walletCount": 2,
  "entryCount": 7,
  "totalBalanceCent": 121800,
  "ledgerNetCent": 121800,
  "mismatchCount": 0,
  "mismatches": []
}
```

每张卡核对四件事，任何一件不对就列进 `mismatches`（最多列 100 张，`mismatchCount` 是总数）：

1. 卡上余额 = 这张卡全部流水逐笔加减之和。加减方向按流水类型推（冲正看被冲原流水的类型），不依赖流水自己记的前后余额。
2. 卡上余额 = 最后一笔流水的后余额。
3. 钱包 `version` = 流水笔数（每记一笔加一）。
4. 每笔的前余额接得上上一笔的后余额。并发时几笔的时间可能完全相同，这种情况按余额重新串一遍再判断，不会误报。

`mismatches` 每项：`memberId`、`memberPhone`（打码）、`memberName`、`balanceCent`、`ledgerNetCent`、`version`、`entryCount`、`lastBalanceAfter`、`chainBreaks`。

## 5. 数据

迁移 `20261027210000_p2_audit`：

- `audit_logs` 加 `store_id`（可空，外键到门店），已有记录按 `payload.storeId` 或门店对象补齐。
- 索引：`(org_id, action, created_at)`、`(org_id, store_id, created_at)`、`(actor_staff_id, created_at)`。
- 触发器：`audit_logs` 只追加，拒绝修改、删除、清空。

因此测试不能再清理操作记录和员工；集成测试每次用一个新的组织，互不影响。

## 6. 验收

- 自动化测试：`apps/api/test/p2-audit-reconciliation.integration.spec.ts`（开卡→充值→扣款→冲正各一条记录、三种角色的可见范围、会员 403、改删被数据库拒绝；对账与逐条流水一致、23:30 / 00:30 跨日、日结、并发记账后核对通过、篡改余额后核对报错）；`business-day.spec.ts`、`ledger-chain.spec.ts`。
- 演示脚本：`apps/api/scripts/p2-acceptance-demo.ts`。本地服务以 `WECHAT_PHONE_MOCK=true` 启动后运行，生成一页验收 HTML。

## 7. 没做的

- 导出 Excel、财务报表、按月汇总：第一版不做，后台需要时再加。
- 定时自动核对和告警：目前由后台打开页面时调用 `GET /reconciliation/check`。
- 失败操作（被拒绝的扣款等）不记操作记录。
