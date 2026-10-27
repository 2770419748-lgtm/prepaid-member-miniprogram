import { Module } from '@nestjs/common';
import { MemberPayCodeController } from './member-pay-code.controller';
import { PayCodeService } from './pay-code.service';
import { PayCodesController } from './pay-codes.controller';

/** 会员码：会员出示、店员扫码，消费扣款必须带上扫到的码。扣款本身仍由 WalletService 记账。 */
@Module({
  controllers: [MemberPayCodeController, PayCodesController],
  providers: [PayCodeService],
  exports: [PayCodeService],
})
export class PayCodeModule {}
