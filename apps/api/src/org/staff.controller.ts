import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { CreateStaffDto, ReplaceStaffRolesDto, StaffListQueryDto, UpdateStaffDto } from './dto/staff.dto';
import { StaffService } from './staff.service';

@ApiTags('员工')
@ApiBearerAuth()
@Principals('STAFF')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('me/stores')
  @ApiOperation({ summary: '查看我能操作的门店。超级管理员看到全部' })
  myStores(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.staff.myStores(actor);
  }

  @Get()
  @Roles('STORE_MANAGER')
  @ApiOperation({ summary: '查看员工。超级管理员看全公司，店长只看自己门店' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: StaffListQueryDto) {
    return this.staff.list(actor, query);
  }

  @Post()
  @Roles('STORE_MANAGER')
  @ApiOperation({ summary: '新建员工并分配门店角色。店长只能在本店新建店员' })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreateStaffDto) {
    return this.staff.create(actor, dto);
  }

  @Patch(':id')
  @Roles('STORE_MANAGER')
  @ApiOperation({ summary: '修改员工姓名或停用。店长不能改超级管理员，也不能改别的店' })
  update(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(actor, id, dto);
  }

  @Put(':id/roles')
  @Roles('STORE_MANAGER')
  @ApiOperation({ summary: '设置员工在各门店的角色。店长不能任命超级管理员' })
  replaceRoles(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: ReplaceStaffRolesDto,
  ) {
    return this.staff.replaceRoles(actor, id, dto);
  }
}
