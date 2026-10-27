# 储值会员

线下记账展示，线上会员权益与电子签。本仓库是工程骨架：后端、商家后台壳、两个微信小程序占位，以及 PostgreSQL 模型。

## 本地启动

需要 Node.js 20+、pnpm 10、Docker（仅用于本地 PostgreSQL）。

```bash
pnpm install
cp .env.example .env
cp .env.example apps/api/.env

docker compose up -d
pnpm --filter api prisma:migrate
pnpm --filter api prisma:seed
pnpm --filter api start:dev
```

另开终端启动商家后台：

```bash
pnpm --filter admin-web dev
```

- API：<http://localhost:3000/health>  
  期望 `{ "ok": true, "esignProductionEnabled": false, "db": "up" }`
- 商家后台：<http://localhost:5173>  
  种子账号 `13800000000`，初始密码 `Init12345`，第一次登录要改密码。接口地址来自 `apps/admin-web/.env.development` 的 `VITE_API_BASE`。页面说明见 [docs/frontend/admin-web.md](docs/frontend/admin-web.md)。

可选对象存储占位（默认不启动）：

```bash
docker compose --profile storage up -d
```

### 小程序

用微信开发者工具分别打开 `apps/member-mp` 与 `apps/staff-mp`。AppID 填测试号，不要把 Secret 写入仓库。两个工程都是「首页」「我的」占位页，说明见各自目录下的 README。

### 常用检查

```bash
pnpm -r lint
pnpm -r typecheck
pnpm --filter api exec prisma validate
pnpm --filter api test
```

`prisma migrate` 使用已提交的迁移：`pnpm --filter api prisma:migrate`（即 `prisma migrate deploy`）。改模型时在 `apps/api` 下执行 `prisma migrate dev`。

## 协作

实现经坤总确认后再推送。PR 请技术部 Code Review。确认前不合入、不部署。

## 禁止事项

- 不引入微信支付 SDK，不做支付回调，小程序不挂支付插件。充值与消费只做线下记账。
- 不要在默认配置下打开正式签署。`ESIGN_PRODUCTION_ENABLED` 必须保持 `false`，直到主体与企业章就绪并由运维显式打开。说明见 [docs/esign-switch.md](docs/esign-switch.md)。
- 不要把密钥提交进仓。AppID、Secret、JWT、数据库口令与对象存储密钥只放本地 `.env`。

## 文档

- [前端](docs/frontend/README.md)：储值会员小程序的会员端（M3）与商家网页后台任务说明
- [进度](docs/PROGRESS.md)

