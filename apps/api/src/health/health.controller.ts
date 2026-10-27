import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from 'shared';
import { Public } from '../auth/decorators';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('健康检查')
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly esignConfig: EsignConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: '服务是否正常，以及正式签署是否关闭' })
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
