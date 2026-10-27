# M2 · 储值账本 — 后端说明

> **状态：** 已实现（`apps/api` 的 `WalletModule` 与 `MembersModule`）。  
> **日期：** 2026-10-27（Asia/Shanghai）  
> **协作：** 2026-10-27 起坤总授权 Claude 端到端推进开发，测试与 CI 通过后自行合并。不部署、不接微信支付、不打开电子签正式开关。  
> **硬约束：** 见 `docs/tech/tech-final.md`。公开文案只用「储值会员」。

---

## 1. 做了什么

| 能力 | 说明 |
| --- | --- |
| 开卡 | 店员登记手机号（可带称呼），同一事务里建会员和余额为 0 的钱包。会员先在小程序登录过也可以，补开钱包即可 |
| 线下充值 | 只记账，不收款。钱在门店线下收 |
| 消费扣款 | 余额不足拒绝；同一张卡被同时扣款也不会扣成负数 |
| 冲正 | 记错了账，补记一笔反方向的把原流水整笔抵掉 |
| 流水查询 | 店员按门店范围查；会员只看自己的 |
| 余额 | 挂在会员钱包上，全公司门店通用 |

## 2. 产品规则

坤总 2026-10-27 拍板：

1. **储值终身有效**，不过期，用完为止。
2. **不做赠送金**，余额只有一个池子。
3. **冲正只能由超级管理员或原门店店长操作，一笔流水只能冲一次。**

实现时定下的默认（可改，改了同步本节）：

4. 冲正是整笔冲回，不做部分冲正。冲正流水记在原流水的门店名下，备注必填。冲正流水本身不能再冲。没有时间限制。
5. 充值已经被花掉、余额不够冲回时，拒绝冲正（不会把余额冲成负数）。
6. 单笔金额 1 分到 100 万元。上限用来挡误录，例如把元当分多打几个 0。
7. 已停用的门店不能开卡、不能记账；已停用的会员不能记账。冲正不受这两条限制（纠错优先）。
8. 会员端明细不显示操作店员和店内备注。

## 3. 权限

| 角色 | 开卡 / 充值 / 扣款 | 冲正 | 查流水 | 查会员 |
| --- | --- | --- | --- | --- |
| 超级管理员 | 任意门店 | 任意流水 | 全公司 | 全公司 |
| 店长 | 本店 | 本店发生的流水 | 本店发生的 | 见下 |
| 店员 | 本店 | 不能 | 本店发生的 | 见下 |
| 会员 | 不能 | 不能 | 只看自己 | 只看自己 |

- 记账时 `storeId` 必须是操作人有权限的门店，否则 403。
- 余额全公司通用，会员可以去任一门店消费。所以**任何门店的店员都能用完整手机号查到会员、看到总余额并给他记账**；模糊查找（手机号片段或称呼）只返回本店开卡或在本店有过流水的会员。
- 店员和店长查流水只看到在自己门店发生的那些，余额仍显示全公司总余额。

## 4. 接口

金额单位一律是**分**（整数）。100 元传 `10000`。

| 方法 | 路径 | 谁能用 | 请求 | 返回 |
| --- | --- | --- | --- | --- |
| POST | `/members/open` | 店员及以上 | `phone`, `name?`, `storeId` | 会员卡（`balanceCent=0`）。已开过卡 409 |
| GET | `/members` | 店员及以上 | `phone?`（完整号精确查）, `keyword?`, `page`, `pageSize` | 分页会员卡 |
| GET | `/members/:id` | 店员及以上 | — | 会员卡，含总余额 |
| GET | `/members/me/wallet` | 会员 | — | `{ hasCard, balanceCent, openedAt, updatedAt }` |
| POST | `/wallets/:memberId/recharge` | 店员及以上 | `storeId`, `amountCent`, `remark?`, `requestId?` | `{ entry, balanceCent, replayed }` |
| POST | `/wallets/:memberId/consume` | 店员及以上 | 同上 | 同上。余额不足 400 |
| POST | `/ledger/:id/reversal` | 超管或原门店店长 | `remark`, `requestId?` | 同上。已冲过 409 |
| GET | `/ledger` | 店员按范围；会员只看自己 | `memberId?`, `storeId?`, `type?`, `from?`, `to?`, `page`, `pageSize` | 分页流水 |
| GET | `/ledger/:id` | 同上 | — | 一条流水 |

会员卡（店员视角）字段：`id`, `phone`, `name`, `status`, `hasCard`, `openStoreId`, `openStoreName`, `balanceCent`, `openedAt`, `wechatBound`, `createdAt`。

流水（店员视角）字段：`id`, `memberId`, `memberPhone`, `memberName`, `storeId`, `storeName`, `operatorStaffId`, `operatorName`, `type`, `amountCent`（绝对值）, `changeCent`（对余额的实际影响，加为正、减为负）, `balanceBefore`, `balanceAfter`, `remark`, `reversalOfId`（冲正指向的原流水）, `reversedById`（被哪笔冲正）, `createdAt`。

流水（会员视角）只有：`id`, `type`, `amountCent`, `changeCent`, `balanceAfter`, `storeName`, `reversalOfId`, `reversed`, `createdAt`。

`from` 含、`to` 不含，ISO 时间，例如 `2026-10-01T00:00:00+08:00`。

**防重复提交：** 前端每次点「确认」生成一个 `requestId`（8–64 位字母、数字、`-`、`_`，UUID 即可），网络重试或连点时带同一个号。同一组织内同一个号只会记一笔：重复提交返回第一次的结果并带 `replayed: true`；同一个号换了金额或会员则 409。

**没有的东西：** 没有修改或删除流水的接口；没有任何支付、支付回调路由；不接受客户端传余额。

## 5. 余额怎么保证不出错

所有余额变动都走 `WalletService` 的同一个入口，一笔一个事务：

```
BEGIN
  读钱包（余额、version）
  消费 / 冲回充值：余额不够 → 400，回滚
  UPDATE wallets SET balance_cent = 新余额, version = version + 1
    WHERE id = … AND version = 读到的 version
  更新 0 行（别人先改了）→ 整笔回滚，稍等后重读重试，最多 8 次，仍冲突返回 409
  INSERT 流水（前后余额、门店、操作人）
  INSERT 操作记录
COMMIT
```

数据库层另有兜底（M2 迁移，Prisma 不描述这些，见 `prisma/migrations/20261027200000_m2_wallet_ledger`）：

- `wallets.balance_cent >= 0`。
- 流水金额为正；前后余额不为负；`RECHARGE` 必须是加、`CONSUME` 必须是减、`REVERSAL` 必须指向原流水且金额对得上。
- `ledger_entries` 触发器拒绝 `UPDATE`、`DELETE` 和 `TRUNCATE`。连带后果：有流水的员工、会员、门店都不能被硬删（本来也没有硬删接口，停用即可）。
- `reversal_of_id` 唯一：同一条流水并发冲正也只会成功一笔。

操作记录：`MEMBER_CARD_OPEN`、`WALLET_RECHARGE`、`WALLET_CONSUME`、`WALLET_REVERSAL`，与业务写入同一事务。

## 6. 测试

- `test/wallet.service.spec.ts`：模拟数据库，覆盖一事务写流水、余额不足不写、版本冲突重试、重试用尽 409、越权门店。
- `test/m2-wallet-ledger.integration.spec.ts`（`RUN_DB_TESTS=1`，CI 用临时 PostgreSQL 16）：验收用例（开卡 → 充 100 元 → 扣 30 元 → 两条流水 → 余额 70 元）、重复开卡、并发开卡、跨店记账 403、余额不足、非法金额、跨店消费、防重复提交（含并发）、5 笔同时透支只成功 1 笔、11 笔同时加减账不丢分、冲正权限与只冲一次、并发冲正、会员只看自己、店员只看本店、数据库拒绝删改与负余额。
- 测试数据不清理（流水删不掉），每次运行用新组织，互不影响。

## 7. 演示

本地服务以 `WECHAT_PHONE_MOCK=true` 启动后：

```bash
ACCEPTANCE_HTML=/tmp/m2-acceptance.html pnpm --filter api exec tsx scripts/m2-acceptance-demo.ts
```

脚本按真实接口走一遍开卡、充值、跨店消费、余额不足、同时扣款、误录与冲正、重复提交、会员查明细，生成一页白话验收报告。
