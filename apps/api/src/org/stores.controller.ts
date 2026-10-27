import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { CreateStoreDto, StoreListQueryDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';

@ApiTags('门店')
@ApiBearerAuth()
@Principals('STAFF')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @ApiOperation({ summary: '查看能访问的门店。超级管理员看全部，其他人只看自己的店' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: StoreListQueryDto) {
    return this.stores.list(actor, query);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '新建门店（仅超级管理员）' })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreateStoreDto) {
    return this.stores.create(actor, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '查看一家门店。没有权限时拒绝' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.stores.get(actor, id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'STORE_MANAGER')
  @ApiOperation({ summary: '修改门店。店长只能改自己店的地址、坐标、电话和营业时间' })
  update(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.stores.update(actor, id, dto);
  }
}
