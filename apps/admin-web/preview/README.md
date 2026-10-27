# 商家后台截图脚本

在本机起接口和后台，用真浏览器把主要页面走一遍并截图，给坤总看页面、开发自查用。只连本机，**不要部署**。

## 用法

```bash
# 1. 干净的本机库（库里只能有一家公司，网页登录不传 orgId）
pnpm --filter api prisma:migrate
pnpm --filter api prisma:seed

# 2. 假电子签平台（会员小程序那边的，3901，控制口 3902）
pnpm --filter member-mp exec tsx preview/fake-esign.mjs

# 3. 接口指向假电子签平台；后台开发服务器
ESIGN_API_HOST=http://127.0.0.1:3901 ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm dev:api
pnpm dev:admin

# 4. 演示数据：三家门店、五个员工、五位会员和几笔流水
node apps/admin-web/preview/seed-demo.mjs

# 5. 截图，35 张
node apps/admin-web/preview/shoot.mjs --out /tmp/admin-shots
# 只跑几组：--only login,firstlogin,admin,manager,esign
```

需要本机装有 Playwright 和 Chromium（`require('playwright')` 能找到即可）。场景会开卡、充值、冲正、建权益方案和发起签署，对同一个库只跑一次；要重跑就从第 1 步换个新库。

## 演示账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| 13800000000 | Admin12345（种子初始密码 Init12345，第 4 步会改掉） | 超级管理员 |
| 13800000001 | Manager123 | 旗舰店店长 张店长 |
| 13800000002 | Clerk12345 | 旗舰店店员 李店员 |
| 13800000003 | Clerk12345 | 社区店店员 王店员 |
| 13800000004 | Init12345（第一次登录必须改密，截图里改成 Zhao123456） | 社区店店员 赵店员 |
| 13800000005 | Manager123 | 社区店店长 陈店长 |

这些只是本机演示库里的账号，不是任何真实环境的密码。

消费必须由店员在员工小程序扫会员码，接口不收不带码的扣款时，`seed-demo.mjs` 会跳过消费那几笔（输出里 `skippedConsume` 是跳过的笔数），其余照常。
