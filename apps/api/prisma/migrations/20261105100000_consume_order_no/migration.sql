-- 消费抵扣带收银订单号（坤总 2026-11-05：店员扫九讯云小票上的订单码，按商品金额的 10% 抵扣）。
-- 流水记下订单号、商品应付金额和单号是不是手输的；另建 order_redemptions 保证同一张订单只能抵一次，
-- 冲正那笔消费后放开，可以重新抵。

ALTER TABLE "ledger_entries"
  ADD COLUMN "order_no" TEXT,
  ADD COLUMN "product_amount_cent" INTEGER,
  ADD COLUMN "order_no_typed" BOOLEAN;

-- 三个字段同有同无，只有消费能带；订单号是规范写法「A+数字」（不以 0 开头）；抵扣不超过商品金额的 10%。
-- 2026-11-05 以前的消费三个字段都为空，照样合法。
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_fields" CHECK (
  ("order_no" IS NULL AND "product_amount_cent" IS NULL AND "order_no_typed" IS NULL)
  OR (
    "type" = 'CONSUME'
    AND "order_no" ~ '^A[1-9][0-9]{0,9}$'
    AND "product_amount_cent" IS NOT NULL
    AND "order_no_typed" IS NOT NULL
    AND "amount_cent"::bigint * 10 <= "product_amount_cent"::bigint
  )
);

CREATE INDEX "ledger_entries_org_id_order_no_idx" ON "ledger_entries"("org_id", "order_no");

CREATE TABLE "order_redemptions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "consume_entry_id" TEXT NOT NULL,
    "released_by_entry_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "order_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_redemptions_consume_entry_id_key" ON "order_redemptions"("consume_entry_id");
CREATE UNIQUE INDEX "order_redemptions_released_by_entry_id_key" ON "order_redemptions"("released_by_entry_id");
CREATE INDEX "order_redemptions_org_id_order_no_idx" ON "order_redemptions"("org_id", "order_no");
-- 核心：同一家公司同一张订单，还没放开的只能有一条。两部手机同时抵同一张单，只有一笔成功。
CREATE UNIQUE INDEX "order_redemptions_active_order_key" ON "order_redemptions"("org_id", "order_no") WHERE "released_at" IS NULL;

ALTER TABLE "order_redemptions" ADD CONSTRAINT "order_redemptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_redemptions" ADD CONSTRAINT "order_redemptions_consume_entry_id_fkey" FOREIGN KEY ("consume_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_redemptions" ADD CONSTRAINT "order_redemptions_released_by_entry_id_fkey" FOREIGN KEY ("released_by_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_redemptions" ADD CONSTRAINT "order_redemptions_released_fields" CHECK (
  ("released_at" IS NULL) = ("released_by_entry_id" IS NULL)
);

-- 占用记录是抵扣凭据：不能删；只能放开一次（填上 released_*），放开后不能再改。Prisma 不描述触发器，只在这里维护。
CREATE FUNCTION "order_redemptions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'order_redemptions: % is not allowed', TG_OP;
  END IF;
  IF OLD."released_at" IS NOT NULL THEN
    RAISE EXCEPTION 'order_redemptions: a released redemption is final';
  END IF;
  IF NEW."org_id" <> OLD."org_id"
    OR NEW."order_no" <> OLD."order_no"
    OR NEW."consume_entry_id" <> OLD."consume_entry_id"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'order_redemptions: only released_at and released_by_entry_id may change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_redemptions_no_delete_or_rewrite"
BEFORE UPDATE OR DELETE ON "order_redemptions"
FOR EACH ROW EXECUTE FUNCTION "order_redemptions_guard"();

CREATE TRIGGER "order_redemptions_no_truncate"
BEFORE TRUNCATE ON "order_redemptions"
FOR EACH STATEMENT EXECUTE FUNCTION "order_redemptions_guard"();
