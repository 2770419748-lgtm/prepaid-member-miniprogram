import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * 账务：线下充值、消费扣款、冲正、流水查询。只记账，不收款，不接微信支付。
 * 余额挂在会员，全公司通用，不按门店拆余额。所有余额变更都走 WalletService。
 */
@Module({
  controllers: [WalletController, LedgerController],
  providers: [WalletService, LedgerService],
  exports: [WalletService, LedgerService],
})
export class WalletModule {}
