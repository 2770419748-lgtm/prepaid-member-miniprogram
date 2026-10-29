-- 开单：权益单带「会员权益金额」，会员签完后自动充值到余额（坤总 2026-10-29：签完合同才到账）。
-- 充值仍由 WalletService 记一笔普通的 RECHARGE 流水，这里只记金额和那笔流水。

ALTER TABLE "sign_flows" ADD COLUMN     "recharge_amount_cent" INTEGER,
ADD COLUMN     "recharge_entry_id" TEXT;

CREATE UNIQUE INDEX "sign_flows_recharge_entry_id_key" ON "sign_flows"("recharge_entry_id");

ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_recharge_entry_id_fkey" FOREIGN KEY ("recharge_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 金额和单笔充值上限一致：1 分到 100 万元。
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_recharge_amount_range" CHECK (
  "recharge_amount_cent" IS NULL OR ("recharge_amount_cent" > 0 AND "recharge_amount_cent" <= 100000000)
);

-- 只有签好的、带金额的权益单才会有那笔充值。
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_recharge_entry_after_signed" CHECK (
  "recharge_entry_id" IS NULL OR ("status" = 'SIGNED' AND "recharge_amount_cent" IS NOT NULL)
);

-- 合同发出去以后金额就写在合同里了，不能再改；记上的充值也不能换成别的流水。Prisma 不描述触发器，只在这里维护。
CREATE FUNCTION "sign_flows_recharge_is_fixed"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND NEW."recharge_amount_cent" IS DISTINCT FROM OLD."recharge_amount_cent" THEN
    RAISE EXCEPTION 'sign_flows: recharge_amount_cent is fixed once the contract is sent';
  END IF;
  IF OLD."recharge_entry_id" IS NOT NULL AND NEW."recharge_entry_id" IS DISTINCT FROM OLD."recharge_entry_id" THEN
    RAISE EXCEPTION 'sign_flows: recharge_entry_id is final';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sign_flows_recharge_fixed"
BEFORE UPDATE ON "sign_flows"
FOR EACH ROW EXECUTE FUNCTION "sign_flows_recharge_is_fixed"();
