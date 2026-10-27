import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { ContractTemplatesService } from './contract-templates.service';
import {
  ContractTemplateListQueryDto,
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract-template.dto';

@ApiTags('权益单')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('contract-templates')
export class ContractTemplatesController {
  constructor(private readonly templates: ContractTemplatesService) {}

  @Get()
  @ApiOperation({ summary: '权益单模板列表' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: ContractTemplateListQueryDto) {
    return this.templates.list(actor, query);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '绑定 e签宝模板（仅超级管理员）。会到 e签宝核对模板是否存在' })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreateContractTemplateDto) {
    return this.templates.create(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看一份权益单模板' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.templates.get(actor, id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '修改模板、换绑或停用（仅超级管理员）。不提供删除' })
  update(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateContractTemplateDto,
  ) {
    return this.templates.update(actor, id, dto);
  }
}
