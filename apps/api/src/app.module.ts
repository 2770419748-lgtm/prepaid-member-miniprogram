import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EsignConfigModule } from './esign-config/esign-config.module';
import { EsignModule } from './esign/esign.module';
import { HealthModule } from './health/health.module';
import { MemberAppModule } from './member-app/member-app.module';
import { MembersModule } from './members/members.module';
import { OrgModule } from './org/org.module';
import { PayCodeModule } from './pay-code/pay-code.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { StorageModule } from './storage/storage.module';
import { WalletModule } from './wallet/wallet.module';

/**
 * AuthModule / OrgModule / MembersModule：账号、门店、员工、会员登录与开卡。
 * WalletModule：线下充值、消费扣款、冲正与流水查询。只记账，禁止微信支付。
 * AuditModule / ReconciliationModule：操作记录查询、当日对账与余额核对。只读。
 * EsignModule：权益方案、权益单模板、e签宝沙箱签署与回调、合同 PDF 归档。正式签署开关默认关闭。
 *   带会员权益金额的权益单签完后经 WalletService 充值。
 * MemberAppModule：开单完成后给顾客扫的会员小程序码。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    StorageModule,
    AuditModule,
    EsignConfigModule,
    HealthModule,
    AuthModule,
    OrgModule,
    MembersModule,
    PayCodeModule,
    WalletModule,
    ReconciliationModule,
    EsignModule,
    MemberAppModule,
  ],
})
export class AppModule {}
