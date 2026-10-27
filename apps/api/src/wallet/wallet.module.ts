import { Module } from '@nestjs/common';
import { PayCodeModule } from '../pay-code/pay-code.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * 账务：线下充值、消费扣款、冲正、流水查询。只记账，不收款，不接微信支付。
 * 余额挂在会员，全公司通用，不按门店拆余额。所有余额变更都走 WalletService。
 * 消费扣款必须带上店员刚扫到的会员码（PayCodeModule），和流水同一事务标成已用。
 */
@Module({
  imports: [PayCodeModule],
  controllers: [WalletController, LedgerController],
  providers: [WalletService, LedgerService],
  exports: [WalletService, LedgerService],
})
export class WalletModule {}
