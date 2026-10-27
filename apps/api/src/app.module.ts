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
import { WalletModule } from './wallet/wallet.module';

/**
 * AuthModule / OrgModule / MembersModule：账号、门店、员工与会员登录。
 * WalletModule TODO(M2)：线下充值、消费、冲正。禁止微信支付。
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
    EsignModule,
  ],
})
export class AppModule {}
