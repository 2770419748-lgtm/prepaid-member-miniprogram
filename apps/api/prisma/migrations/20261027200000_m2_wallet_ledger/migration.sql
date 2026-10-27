-- M2 储值账本：开卡称呼、开卡时间、冲正关联、防重复提交，以及数据库层的账务兜底。

ALTER TABLE "members" ADD COLUMN "name" TEXT;

ALTER TABLE "wallets" ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ledger_entries" ADD COLUMN "reversal_of_id" TEXT,
ADD COLUMN "request_id" TEXT;

CREATE UNIQUE INDEX "ledger_entries_reversal_of_id_key" ON "ledger_entries"("reversal_of_id");
CREATE UNIQUE INDEX "ledger_entries_org_id_request_id_key" ON "ledger_entries"("org_id", "request_id");
CREATE INDEX "ledger_entries_store_id_created_at_idx" ON "ledger_entries"("store_id", "created_at");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 以下约束 Prisma 不描述，只在这里维护。应用代码出错时由数据库拒绝写入。

-- 余额永远不为负。
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_cent_non_negative" CHECK ("balance_cent" >= 0);

-- 金额为正整数；前后余额不为负；前后余额与类型、金额对得上；只有冲正带原流水。
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_cent" > 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_balance_non_negative" CHECK ("balance_before" >= 0 AND "balance_after" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_balance_matches_type" CHECK (
  ("type" = 'RECHARGE' AND "reversal_of_id" IS NULL AND "balance_after"::bigint = "balance_before"::bigint + "amount_cent")
  OR ("type" = 'CONSUME' AND "reversal_of_id" IS NULL AND "balance_after"::bigint = "balance_before"::bigint - "amount_cent")
  OR ("type" = 'REVERSAL' AND "reversal_of_id" IS NOT NULL AND abs("balance_after"::bigint - "balance_before"::bigint) = "amount_cent")
);

-- 流水只追加：拒绝修改、删除和清空。纠错另记一笔 REVERSAL。
CREATE FUNCTION "ledger_entries_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only, % is not allowed', TG_OP
    USING HINT = 'Record a REVERSAL entry instead.';
END;
$$;

CREATE TRIGGER "ledger_entries_no_update_delete"
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "ledger_entries_append_only"();

CREATE TRIGGER "ledger_entries_no_truncate"
BEFORE TRUNCATE ON "ledger_entries"
FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entries_append_only"();
