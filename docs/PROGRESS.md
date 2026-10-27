# 交接进度

截至 2026-10-28。这份说明给接下来用 Claude 接手的人：仓库现在到哪一步、哪些合进来了、哪些 PR 还开着不能丢、后面按什么顺序做。

## 项目状态总览

- 仓库：prepaid-member-miniprogram
- 坤总决定：开发部把手头活做完、进度同步进 docs 后停工，后续由 Claude 接手实现；助手侧不再新开写码任务。
- 交付方式：不搭测试服务器；每完成一块，在项目群发截图和白话说明。
- 坤总看不懂代码：用看得见的页面交付，每块都配截图和白话说明。

## 已合入 main

- PR #1 [M0 骨架](https://github.com/2770419748-lgtm/prepaid-member-miniprogram/pull/1)：monorepo、NestJS + Prisma、Vue3 后台壳、两个小程序占位、十一类数据、电子签开关默认关、`docs/tech` 等。
- PR #4 [会员端「可用门店」需求](https://github.com/2770419748-lgtm/prepaid-member-miniprogram/pull/4)：技术部已通过，总经理已合入。需求正文在 main 上的 [docs/requirements/member-stores.md](./requirements/member-stores.md)。

## 打开中的 PR（勿丢）

1. PR #3 [M1 账号与门店](https://github.com/2770419748-lgtm/prepaid-member-miniprogram/pull/3)。技术部初审：`apps/api/src/org/staff.service.ts` 的 `replaceRoles` 有 2 处店长权限漏洞。店长不能提拔店员当店长，也不能改、撤同店其他店长（含自己），只能管普通店员。请在这里修好，并各补一条测试。另外还要做：门店加上详细地址、经纬度、电话、营业时间；网页后台登录改成「手机号 + 密码」（bcrypt 存密码，连续输错 5 次锁 15 分钟，第一次登录必须改掉初始密码）；会员只能看门店，员工相关接口对会员关掉。改完等技术部复审，再由总经理评估合并。
2. PR #2 [前端任务说明](https://github.com/2770419748-lgtm/prepaid-member-miniprogram/pull/2)：M3 会员小程序和商家后台的任务说明。这份 PR 里可能还有一份旧的 `docs/PROGRESS.md`，和本文件对不上。先和本文件对齐，再由总经理评估要不要合并。

## 已拍板需求（重要）

- 会员端：不设任何员工入口。「可用门店」页要有店名、地址、营业时间、距离、导航（`wx.openLocation`）、电话拨号。没有门店时，文案是「暂无可用门店，请联系商家」。细则见 [docs/requirements/member-stores.md](./requirements/member-stores.md)，该文件已在 main。
- 网页后台登录：手机号 + 密码，不用短信。小程序：微信授权手机号。开发阶段可以用假手机号。
- 设计主色 `#1677FF`。产品设计对登录壳的观感意见（主按钮用信任蓝、去掉调试入口、概览卡片等高并带上品牌、去掉「占位」）在接入真实登录时一并改。

## 里程碑顺序（给 Claude）

M0 已合入。下一步收尾并合上 M1（PR #3），然后做 M2 账本。再往后可以并行：M3 会员小程序、商家后台、M4 电子签、M5 员工小程序。

## 停工边界

开发部只收到尾：PR #3 改完交给技术部复审即可。前端还没开的新 PR 不再开。之后的新功能由坤总用 Claude 做。
