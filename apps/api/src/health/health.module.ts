import { Module } from '@nestjs/common';
import { EsignConfigModule } from '../esign-config/esign-config.module';
import { HealthController } from './health.controller';

@Module({
  imports: [EsignConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
