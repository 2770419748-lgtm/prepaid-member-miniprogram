import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from 'shared';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(
    private readonly esignConfig: EsignConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  async check(): Promise<HealthResponse> {
    return {
      ok: true,
      esignProductionEnabled: this.esignConfig.productionEnabled,
      db: await this.pingDb(),
    };
  }

  private async pingDb(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
