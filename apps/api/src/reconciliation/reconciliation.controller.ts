import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { DailyReconciliationQueryDto } from './dto/reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('对账')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('daily')
  @ApiOperation({ summary: '当日对账：按门店汇总某天（上海时间）的充值、消费和冲正。只读' })
  daily(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: DailyReconciliationQueryDto) {
    return this.reconciliation.daily(actor, query);
  }

  @Get('overview')
  @ApiOperation({ summary: '后台概览：开卡数、储值总额（仅超级管理员）、今日充值与消费' })
  overview(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reconciliation.overview(actor);
  }

  @Get('check')
  @ApiOperation({ summary: '余额核对（仅超级管理员）：逐只钱包核对余额与流水，列出对不上的' })
  check(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reconciliation.check(actor);
  }
}
