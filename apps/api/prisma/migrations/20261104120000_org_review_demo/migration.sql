-- 微信审核体验入口：演示公司指向真实公司；真实公司记录入口开到什么时候和审核密码的哈希。
ALTER TABLE "orgs" ADD COLUMN "demo_of_id" TEXT;
ALTER TABLE "orgs" ADD COLUMN "review_demo_until" TIMESTAMPTZ(6);
ALTER TABLE "orgs" ADD COLUMN "review_demo_password_hash" TEXT;

CREATE UNIQUE INDEX "orgs_demo_of_id_key" ON "orgs"("demo_of_id");

ALTER TABLE "orgs" ADD CONSTRAINT "orgs_demo_of_id_fkey" FOREIGN KEY ("demo_of_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 演示公司自己不能再开审核入口，也不能指向自己。
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_demo_has_no_review_entry" CHECK (
  "demo_of_id" IS NULL OR ("demo_of_id" <> "id" AND "review_demo_until" IS NULL AND "review_demo_password_hash" IS NULL)
);
