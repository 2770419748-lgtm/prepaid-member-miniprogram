import { Module } from '@nestjs/common';
import { EsignConfigModule } from '../esign-config/esign-config.module';
import { WalletModule } from '../wallet/wallet.module';
import { BenefitPlansController } from './benefit-plans.controller';
import { BenefitPlansService } from './benefit-plans.service';
import { EsignClient } from './client/esign.client';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplatesService } from './contract-templates.service';
import { EsignWebhookController } from './esign-webhook.controller';
import { MemberSignFlowsController } from './member-sign-flows.controller';
import { MemberSignFlowsService } from './member-sign-flows.service';
import { PaperAgreementsController } from './paper-agreements.controller';
import { PaperAgreementsService } from './paper-agreements.service';
import { SignFlowSyncService } from './sign-flow-sync.service';
import { SignFlowsController } from './sign-flows.controller';
import { SignFlowsService } from './sign-flows.service';

/**
 * 权益单：权益方案、开单上传纸质协议单（2026-11-05 起默认）、电子签（模板、发起签署、回调与状态同步、合同归档，SIGN_MODE=esign 才用）。
 * 每次调用 e签宝都经 EsignClient 核对环境；ESIGN_PRODUCTION_ENABLED 默认 false，只打沙箱。
 * 带会员权益金额的权益单签完后经 WalletService 充值（WalletModule），这里不直接改余额。
 */
@Module({
  imports: [EsignConfigModule, WalletModule],
  controllers: [
    BenefitPlansController,
    ContractTemplatesController,
    SignFlowsController,
    PaperAgreementsController,
    MemberSignFlowsController,
    EsignWebhookController,
  ],
  providers: [
    EsignClient,
    BenefitPlansService,
    ContractTemplatesService,
    SignFlowsService,
    SignFlowSyncService,
    PaperAgreementsService,
    MemberSignFlowsService,
  ],
  exports: [EsignClient],
})
export class EsignModule {}
