-- 开单改为上传纸质协议单（坤总 2026-11-05：不签电子合同了，改成上传纸质协议单，会员在小程序里能看）。
-- 权益单多一种签法 PAPER：顾客在门店签纸质协议单，店员拍照上传，上传即算签好并充值。电子签（ESIGN）的代码和数据都保留，
-- 由 SIGN_MODE 开关决定开单走哪种。照片存对象存储（私有），库里只记 key。

-- CreateEnum
CREATE TYPE "SignKind" AS ENUM ('ESIGN', 'PAPER');

-- AlterTable
ALTER TABLE "sign_flows" ADD COLUMN     "benefit_plan_id" TEXT,
ADD COLUMN     "kind" "SignKind" NOT NULL DEFAULT 'ESIGN',
ALTER COLUMN "template_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agreement_photos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "sign_flow_id" TEXT,
    "uploader_staff_id" TEXT,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attached_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_staff_id" TEXT,
    "remove_reason" TEXT,

    CONSTRAINT "agreement_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_photos_object_key_key" ON "agreement_photos"("object_key");

-- CreateIndex
CREATE INDEX "agreement_photos_sign_flow_id_created_at_idx" ON "agreement_photos"("sign_flow_id", "created_at");

-- CreateIndex
CREATE INDEX "agreement_photos_org_id_uploader_staff_id_created_at_idx" ON "agreement_photos"("org_id", "uploader_staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_benefit_plan_id_fkey" FOREIGN KEY ("benefit_plan_id") REFERENCES "benefit_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_photos" ADD CONSTRAINT "agreement_photos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_photos" ADD CONSTRAINT "agreement_photos_sign_flow_id_fkey" FOREIGN KEY ("sign_flow_id") REFERENCES "sign_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_photos" ADD CONSTRAINT "agreement_photos_uploader_staff_id_fkey" FOREIGN KEY ("uploader_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_photos" ADD CONSTRAINT "agreement_photos_removed_by_staff_id_fkey" FOREIGN KEY ("removed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 以下约束 Prisma 不描述，只在这里维护。

-- 电子签离开发起中就必须有 e签宝流程号；纸质协议单没有 e签宝流程。
ALTER TABLE "sign_flows" DROP CONSTRAINT "sign_flows_esign_flow_id_after_draft";
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_esign_flow_id_after_draft" CHECK (
  "kind" = 'PAPER' OR "status" = 'DRAFT' OR "esign_flow_id" IS NOT NULL
);

-- 电子签一定有模板，方案从模板上取，不直接挂方案。
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_esign_has_template" CHECK (
  "kind" = 'PAPER' OR ("template_id" IS NOT NULL AND "benefit_plan_id" IS NULL)
);

-- 纸质协议单一建好就是已签署：有门店、有会员权益金额、有签署时间，没有模板和 e签宝流程。
ALTER TABLE "sign_flows" ADD CONSTRAINT "sign_flows_paper_is_signed" CHECK (
  "kind" = 'ESIGN' OR (
    "status" = 'SIGNED'
    AND "template_id" IS NULL
    AND "esign_flow_id" IS NULL
    AND "store_id" IS NOT NULL
    AND "recharge_amount_cent" IS NOT NULL
    AND "signed_at" IS NOT NULL
  )
);

-- 签法建好以后不能改。
CREATE FUNCTION "sign_flows_kind_is_fixed"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'sign_flows: kind is fixed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sign_flows_kind_fixed"
BEFORE UPDATE ON "sign_flows"
FOR EACH ROW EXECUTE FUNCTION "sign_flows_kind_is_fixed"();

-- 照片挂到协议单上以后不能挪到别的单、不能恢复删除、不能删行（删除只是标记并删掉文件，留下谁删的）。
-- 还没挂上的（店员传了没交单）可以删行，方便以后清理。
CREATE FUNCTION "agreement_photos_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."sign_flow_id" IS NOT NULL THEN
      RAISE EXCEPTION 'agreement_photos: attached photos cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."sign_flow_id" IS NOT NULL AND NEW."sign_flow_id" IS DISTINCT FROM OLD."sign_flow_id" THEN
    RAISE EXCEPTION 'agreement_photos: sign_flow_id is final';
  END IF;
  IF OLD."removed_at" IS NOT NULL AND NEW."removed_at" IS DISTINCT FROM OLD."removed_at" THEN
    RAISE EXCEPTION 'agreement_photos: removal is final';
  END IF;
  IF NEW."object_key" IS DISTINCT FROM OLD."object_key" THEN
    RAISE EXCEPTION 'agreement_photos: object_key is fixed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agreement_photos_guarded"
BEFORE UPDATE OR DELETE ON "agreement_photos"
FOR EACH ROW EXECUTE FUNCTION "agreement_photos_guard"();

-- 照片大小（字节）：大于 0，不超过 20MB（接口限 8MB，这里留余量）。
ALTER TABLE "agreement_photos" ADD CONSTRAINT "agreement_photos_size_range" CHECK (
  "size_bytes" > 0 AND "size_bytes" <= 20971520
);
