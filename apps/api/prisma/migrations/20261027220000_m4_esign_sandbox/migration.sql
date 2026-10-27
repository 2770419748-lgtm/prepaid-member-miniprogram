-- M4 电子签沙箱：权益单模板的签名/盖章关键字；签署流程的发起门店、发起人、标题快照、防重复提交、签署完成时间与最近核对时间。

-- DropIndex
DROP INDEX "sign_flows_member_id_idx";

-- DropIndex
DROP INDEX "sign_flows_org_id_idx";

-- AlterTable
ALTER TABLE "contract_templates" ADD COLUMN     "member_sign_keyword" TEXT NOT NULL DEFAULT '会员签字',
ADD COLUMN     "seal_keyword" TEXT NOT NULL DEFAULT '商家盖章';

-- AlterTable
ALTER TABLE "sign_flows" ADD COLUMN     "esign_file_id" TEXT,
ADD COLUMN     "initiator_staff_id" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "signed_at" TIMESTAMPTZ(6),
ADD COLUMN     "store_id" TEXT,
ADD COLUMN     "synced_at" TIMESTAMPTZ(6),
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "sign_flows_esign_flow_id_key" ON "sign_flows"("esign_flow_id");

-- CreateIndex
CREATE INDEX "sign_flows_org_id_created_at_idx" ON "sign_flows"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "sign_flows_member_id_created_at_idx" ON "sign_flows"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "sign_flows_store_id_created_at_idx" ON "sign_flows"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sign_flows_org_id_request_id_key" ON "sign_flows"("org_id", "request_id");

-- AddForeignKey
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_initiator_staff_id_fkey" FOREIGN KEY ("initiator_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 以下约束 Prisma 不描述，只在这里维护。

-- 同一会员同一模板最多一份未完成的签署，避免重复发起、重复计费。
CREATE UNIQUE INDEX "sign_flows_one_open_per_member_template" ON "sign_flows"("member_id", "template_id") WHERE "status" IN ('DRAFT', 'PENDING');

-- 已发起（离开 DRAFT）的流程必须有 e签宝流程号。
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_esign_flow_id_after_draft" CHECK ("status" = 'DRAFT' OR "esign_flow_id" IS NOT NULL);
