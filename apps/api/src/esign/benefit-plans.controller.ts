import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { BenefitPlansService } from './benefit-plans.service';
import { BenefitPlanListQueryDto, CreateBenefitPlanDto, UpdateBenefitPlanDto } from './dto/benefit-plan.dto';

@ApiTags('权益单')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('benefit-plans')
export class BenefitPlansController {
  constructor(private readonly plans: BenefitPlansService) {}

  @Get()
  @ApiOperation({ summary: '权益方案列表' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: BenefitPlanListQueryDto) {
    return this.plans.list(actor, query);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '新建权益方案（仅超级管理员）' })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreateBenefitPlanDto) {
    return this.plans.create(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看一个权益方案' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.plans.get(actor, id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '修改权益方案或上下架（仅超级管理员）。不提供删除' })
  update(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateBenefitPlanDto,
  ) {
    return this.plans.update(actor, id, dto);
  }
}
