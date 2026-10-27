import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { AuditQueryService } from './audit-query.service';
import { AuditLogQueryDto } from './dto/audit-query.dto';

/** 只有查询。操作记录没有修改和删除接口，数据库也拒绝改动。 */
@ApiTags('操作记录')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @ApiOperation({ summary: '查操作记录。超级管理员看全公司；店长看所管门店的和自己做的；店员只看自己做的' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: AuditLogQueryDto) {
    return this.audit.list(actor, query);
  }

  @Get('actions')
  @ApiOperation({ summary: '操作类型和中文名，供筛选下拉' })
  actions() {
    return this.audit.actions();
  }

  @Get(':id')
  @ApiOperation({ summary: '一条操作记录的详情' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.audit.get(actor, id);
  }
}
