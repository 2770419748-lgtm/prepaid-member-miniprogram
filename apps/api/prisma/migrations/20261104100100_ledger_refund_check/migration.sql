-- 前后余额与类型、金额对得上：在 M2 的约束上加上 REFUND（和消费一样减余额，不带原流水）。
-- 冲正一笔退款时仍是 REVERSAL，余额加回来，沿用原来的冲正规则。
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_balance_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_balance_matches_type" CHECK (
  ("type" = 'RECHARGE' AND "reversal_of_id" IS NULL AND "balance_after"::bigint = "balance_before"::bigint + "amount_cent")
  OR ("type" = 'CONSUME' AND "reversal_of_id" IS NULL AND "balance_after"::bigint = "balance_before"::bigint - "amount_cent")
  OR ("type" = 'REFUND' AND "reversal_of_id" IS NULL AND "balance_after"::bigint = "balance_before"::bigint - "amount_cent")
  OR ("type" = 'REVERSAL' AND "reversal_of_id" IS NOT NULL AND abs("balance_after"::bigint - "balance_before"::bigint) = "amount_cent")
);
