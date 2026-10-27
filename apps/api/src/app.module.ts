import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { EsignConfigModule } from './esign-config/esign-config.module';
import { EsignModule } from './esign/esign.module';
import { HealthModule } from './health/health.module';
import { OrgModule } from './org/org.module';
import { PrismaModule } from './prisma/prisma.module';
import { WalletModule } from './wallet/wallet.module';

/**
 * 空模块边界（本里程碑无业务实现）：
 * - AuthModule TODO(M1)
 * - OrgModule TODO(M1)
 * - WalletModule TODO(M2)
 * - EsignModule TODO(M4)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    EsignConfigModule,
    HealthModule,
    AuthModule,
    OrgModule,
    WalletModule,
    EsignModule,
  ],
})
export class AppModule {}
