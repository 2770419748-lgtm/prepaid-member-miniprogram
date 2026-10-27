import { Module } from '@nestjs/common';

/**
 * 账务边界。
 * TODO(M2): 线下充值、消费、冲正。
 * 任何余额变更必须写 LedgerEntry；扣款前校验余额；事务 + Wallet.version 乐观锁。
 * 余额挂在会员，全公司通用，不按门店拆余额。
 * 禁止引入微信支付 SDK 与支付回调。
 */
@Module({})
export class WalletModule {}
