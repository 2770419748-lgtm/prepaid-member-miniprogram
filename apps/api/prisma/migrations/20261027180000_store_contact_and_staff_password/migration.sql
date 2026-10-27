-- 门店补充导航和营业信息；员工网页后台使用密码，不使用短信验证码。

ALTER TABLE "stores" ADD COLUMN "lat" DECIMAL(9,6),
ADD COLUMN "lng" DECIMAL(10,6),
ADD COLUMN "contact_phone" TEXT,
ADD COLUMN "business_hours" TEXT;

ALTER TABLE "staff" ADD COLUMN "password_hash" TEXT,
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "locked_until" TIMESTAMPTZ(6);
