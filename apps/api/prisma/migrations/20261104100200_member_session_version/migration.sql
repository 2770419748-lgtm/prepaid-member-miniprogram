-- 会员登录版本号：超级管理员给会员换手机号或停用时加一，会员小程序之前的登录全部作废（丢手机、换号）。
ALTER TABLE "members" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
