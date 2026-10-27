# 架构与模块边界

储值会员：线下记账展示，线上会员权益与电子签。本文件描述 M0 骨架，业务实现按里程碑接入。

## 仓库

| 路径 | 职责 |
| --- | --- |
| `apps/api` | NestJS + Prisma + PostgreSQL |
| `apps/admin-web` | Vue3 + Vite + Ant Design Vue 商家后台壳 |
| `apps/member-mp` | 会员微信小程序（原生 + TypeScript 占位） |
| `apps/staff-mp` | 商家微信小程序（原生 + TypeScript 占位） |
| `packages/shared` | 金额单位、角色常量、健康检查类型 |

## 后端模块

已接入配置、数据库、健康检查、电子签开关、M1 的账号门店员工、M2 储值账本，以及 M4 电子签沙箱（见 [PROGRESS.md](./PROGRESS.md)）：

- `ConfigModule`：读取环境变量
- `PrismaModule`：PostgreSQL
- `HealthModule`：`GET /health`
- `EsignConfigModule`：`esign.production.enabled` 读取、按网关地址判断沙箱 / 正式并拦住未开启的正式调用
- `EsignModule`：权益方案、权益单模板、e签宝沙箱签署、回调与刷新、合同归档
- `StorageModule`：对象存储（S3 / MinIO，开发时可落本机目录），存合同 PDF
- `AuthModule`：小程序微信登录、网页后台密码登录、JWT、角色鉴权
- `OrgModule`：组织、门店、员工
- `MembersModule`：会员资料、可使用门店、开卡与查会员
- `WalletModule`：线下充值、消费扣款、冲正、流水查询。余额只经 `WalletService` 改动

角色：`SUPER_ADMIN`、`STORE_MANAGER`、`STAFF`。店长只能管理普通店员。

## 账务

- 金额用整数分（`balanceCent` / `amountCent`）。
- `Wallet` 挂在会员上，余额全公司通用，不按门店拆分。
- 任何余额变更必须写 `LedgerEntry`，扣款前校验余额。
- 更新余额使用 `Wallet.version` 乐观锁：`where version = 当前值`，成功后 `version + 1`。
- `LedgerEntry` 只追加：数据库触发器拒绝修改、删除和清空，纠错另记一笔 `REVERSAL`。余额不为负、前后余额与类型对得上，由数据库 CHECK 约束兜底。
- 规则与接口见 [backend/m2-ledger.md](./backend/m2-ledger.md)。

## 明确不做

- 不引入微信支付 SDK，不做支付回调，小程序不挂支付插件。
- 默认不走正式签署。见 [esign-switch.md](./esign-switch.md)。
- 密钥只放本机 `.env`，不提交进仓。
