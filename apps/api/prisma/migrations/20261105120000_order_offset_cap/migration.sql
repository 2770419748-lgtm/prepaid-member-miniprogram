-- 一张收银订单最多抵 1000 元（坤总 2026-11-05：「系统内设置为单品订单最高抵扣1000元」）。
-- 和 10% 一样由数据库兜底：带订单号的消费，金额不能超过 100000 分。改上限要连 src/wallet/order-no.ts 一起改。
-- 2026-11-05 以前没带订单号的消费不受影响。
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_offset_cap" CHECK (
  "order_no" IS NULL OR "amount_cent" <= 100000
);
