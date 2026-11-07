-- 调店留痕：操作记录除了发生门店，再记上牵涉到的门店（调出、调入的门店）。
-- 这些门店的店长也能看到这条记录。操作记录只追加，旧记录不回填（触发器拒绝修改）。

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "related_store_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "audit_logs_related_store_ids_idx" ON "audit_logs" USING GIN ("related_store_ids");
