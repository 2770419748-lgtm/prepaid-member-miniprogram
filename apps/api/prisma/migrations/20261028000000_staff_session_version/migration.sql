-- 员工登录版本号：写进登录凭证，改密码或被重置密码后加一，之前签发的凭证全部作废，要重新登录。

ALTER TABLE "staff" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
