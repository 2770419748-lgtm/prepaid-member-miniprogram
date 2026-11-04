-- 退余额：新的流水类型 REFUND。店长或超级管理员把会员没用完的储值退给顾客（钱在线下退），余额减少。
-- 新的枚举值要在这次迁移提交以后才能用，所以 CHECK 约束放在下一个迁移里改。
ALTER TYPE "LedgerType" ADD VALUE 'REFUND';
