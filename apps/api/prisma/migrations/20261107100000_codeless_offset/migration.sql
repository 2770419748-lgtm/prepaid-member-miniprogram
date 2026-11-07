-- 店长无码抵扣（坤总 2026-11-07：「可以给店长开一个无码抵扣的权限，抵扣的不用连接到九讯云的系统，记录在小程序即可」）。
-- 顾客没带手机、出示不了会员码时，本店店长或超级管理员按手机号找到会员直接抵扣：不扫会员码，九讯云单号选填。
-- 照样最多抵商品应付金额的 10%、一张单最多 1000 元；填了单号照样一单一抵。必须写原因，流水标成无码抵扣。

ALTER TABLE "ledger_entries" ADD COLUMN "codeless" BOOLEAN NOT NULL DEFAULT false;

-- 订单字段：原来三个字段同有同无；现在无码抵扣可以只有商品应付金额、没有单号。
-- 有商品金额就必须是消费、不超过 10%；有单号就必须是规范写法并记下是不是手输的。
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_order_fields";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_fields" CHECK (
  ("order_no" IS NULL AND "product_amount_cent" IS NULL AND "order_no_typed" IS NULL)
  OR (
    "type" = 'CONSUME'
    AND "product_amount_cent" IS NOT NULL
    AND "amount_cent"::bigint * 10 <= "product_amount_cent"::bigint
    AND (
      ("order_no" ~ '^A[1-9][0-9]{0,9}$' AND "order_no_typed" IS NOT NULL)
      OR ("codeless" AND "order_no" IS NULL AND "order_no_typed" IS NULL)
    )
  )
);

-- 一张单最多抵 1000 元：原来按「带单号」判断，现在没单号的无码抵扣也要封顶，改按「带商品金额」判断。
-- 以前带单号的消费一定带商品金额，所以老数据照样满足。
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_order_offset_cap";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_offset_cap" CHECK (
  "product_amount_cent" IS NULL OR "amount_cent" <= 100000
);

-- 无码抵扣只能是消费，必须带商品应付金额（才封得住 10%）和原因。
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_codeless" CHECK (
  NOT "codeless"
  OR (
    "type" = 'CONSUME'
    AND "product_amount_cent" IS NOT NULL
    AND "remark" IS NOT NULL
    AND btrim("remark") <> ''
  )
);

-- 后台「只看无码抵扣」。
CREATE INDEX "ledger_entries_org_id_codeless_idx" ON "ledger_entries"("org_id", "created_at") WHERE "codeless";
