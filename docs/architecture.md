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

已接入的只有配置、数据库、健康检查和电子签开关：

- `ConfigModule`：读取环境变量
- `PrismaModule`：PostgreSQL
- `HealthModule`：`GET /health`
- `EsignConfigModule`：`esign.production.enabled` 读取与沙箱校验

空模块只标边界，没有业务代码：

| 模块 | 标记 | 后续内容 |
| --- | --- | --- |
| `AuthModule` | TODO(M1) | 微信登录、JWT、角色鉴权 |
| `OrgModule` | TODO(M1) | 组织、门店、员工 |
| `WalletModule` | TODO(M2) | 线下充值 / 消费 / 冲正 |
| `EsignModule` | TODO(M4) | 模板与签署流程；真实调用不在本里程碑 |

角色预留：`SUPER_ADMIN`、`STORE_MANAGER`、`STAFF`。

## 账务

- 金额用整数分（`balanceCent` / `amountCent`）。
- `Wallet` 挂在会员上，余额全公司通用，不按门店拆分。
- 任何余额变更必须写 `LedgerEntry`，扣款前校验余额。
- 更新余额使用 `Wallet.version` 乐观锁：`where version = 当前值`，成功后 `version + 1`。
- `LedgerEntry` 禁止硬删。关联删除策略为 Restrict；可选操作人删除时 SetNull。

## 明确不做

- 不引入微信支付 SDK，不做支付回调，小程序不挂支付插件。
- 默认不走正式签署。见 [esign-switch.md](./esign-switch.md)。
- 密钥只放本机 `.env`，不提交进仓。
