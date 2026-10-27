import { Module } from '@nestjs/common';
import { EsignConfigService } from './esign-config.service';

@Module({
  providers: [EsignConfigService],
  exports: [EsignConfigService],
})
export class EsignConfigModule {}
