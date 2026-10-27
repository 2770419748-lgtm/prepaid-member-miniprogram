import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EsignConfigModule } from './esign-config/esign-config.module';
import { EsignModule } from './esign/esign.module';
import { HealthModule } from './health/health.module';
import { MembersModule } from './members/members.module';
import { OrgModule } from './org/org.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { WalletModule } from './wallet/wallet.module';

/**
 * AuthModule / OrgModule / MembersModule：账号、门店、员工、会员登录与开卡。
 * WalletModule：线下充值、消费扣款、冲正与流水查询。只记账，禁止微信支付。
 * AuditModule / ReconciliationModule：操作记录查询、当日对账与余额核对。只读。
 * EsignModule TODO(M4)：正式签署开关默认关闭。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuditModule,
    EsignConfigModule,
    HealthModule,
    AuthModule,
    OrgModule,
    MembersModule,
    WalletModule,
    ReconciliationModule,
    EsignModule,
  ],
})
export class AppModule {}
