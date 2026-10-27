-- P2 审计与对账：操作记录带上发生门店，便于店长看本店记录；操作记录只追加。

ALTER TABLE "audit_logs" ADD COLUMN "store_id" TEXT;

-- 补齐已有记录的门店：开卡、记账、新建员工的 payload 里带 storeId；门店自身的操作看 target。
UPDATE "audit_logs" AS a
SET "store_id" = s."id"
FROM "stores" AS s
WHERE a."store_id" IS NULL
  AND a."org_id" = s."org_id"
  AND s."id" = COALESCE(
    a."payload_json" ->> 'storeId',
    CASE WHEN a."target_type" = 'Store' THEN a."target_id" END
  );

CREATE INDEX "audit_logs_org_id_action_created_at_idx" ON "audit_logs"("org_id", "action", "created_at");
CREATE INDEX "audit_logs_org_id_store_id_created_at_idx" ON "audit_logs"("org_id", "store_id", "created_at");
CREATE INDEX "audit_logs_actor_staff_id_created_at_idx" ON "audit_logs"("actor_staff_id", "created_at");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 操作记录只追加：拒绝修改、删除和清空。Prisma 不描述触发器，只在这里维护。
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only, % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "audit_logs_no_update_delete"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "audit_logs_no_truncate"
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_append_only"();
