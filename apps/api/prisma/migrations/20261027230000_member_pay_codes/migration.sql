-- 会员码：消费扣款前店员必须先扫会员小程序里的会员码。码只能用一次、很快过期，库里只存哈希。

CREATE TYPE "PayCodeStatus" AS ENUM ('ISSUED', 'SCANNED', 'USED');

CREATE TABLE "member_pay_codes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "status" "PayCodeStatus" NOT NULL DEFAULT 'ISSUED',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "scanned_at" TIMESTAMPTZ(6),
    "scanned_by_staff_id" TEXT,
    "scanned_store_id" TEXT,
    "claim_expires_at" TIMESTAMPTZ(6),
    "used_at" TIMESTAMPTZ(6),
    "ledger_entry_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pay_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "member_pay_codes_code_hash_key" ON "member_pay_codes"("code_hash");
CREATE UNIQUE INDEX "member_pay_codes_ledger_entry_id_key" ON "member_pay_codes"("ledger_entry_id");
CREATE INDEX "member_pay_codes_member_id_status_idx" ON "member_pay_codes"("member_id", "status");

ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_scanned_by_staff_id_fkey" FOREIGN KEY ("scanned_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_scanned_store_id_fkey" FOREIGN KEY ("scanned_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 状态和字段要对得上：扫过的一定有扫码门店和扣款期限，用过的一定指向那笔流水。
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_scanned_fields" CHECK (
  "status" = 'ISSUED'
  OR ("scanned_at" IS NOT NULL AND "scanned_store_id" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
);
ALTER TABLE "member_pay_codes" ADD CONSTRAINT "member_pay_codes_used_fields" CHECK (
  ("status" = 'USED') = ("ledger_entry_id" IS NOT NULL AND "used_at" IS NOT NULL)
);

-- 用过的码是扣款凭据，和流水一样不能再改、不能删。Prisma 不描述触发器，只在这里维护。
CREATE FUNCTION "member_pay_codes_used_is_final"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'USED' THEN
    RAISE EXCEPTION 'member_pay_codes: a used code is final, % is not allowed', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "member_pay_codes_used_no_update_delete"
BEFORE UPDATE OR DELETE ON "member_pay_codes"
FOR EACH ROW EXECUTE FUNCTION "member_pay_codes_used_is_final"();
