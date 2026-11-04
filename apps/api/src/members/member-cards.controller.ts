import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { MemberListQueryDto, MemberStatusDto, OpenCardDto, UpdateMemberDto } from './dto/member-card.dto';
import { MemberAdminService } from './member-admin.service';
import { MemberCardsService } from './member-cards.service';

/**
 * 店员侧的会员管理。和会员自己的 /members/me、/members/stores 同一前缀，
 * 所以在 MembersModule 里排在 MembersController 之后，GET /members/:id 不会吃掉那两条路由。
 */
@ApiTags('会员卡')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('members')
export class MemberCardsController {
  constructor(
    private readonly cards: MemberCardsService,
    private readonly admin: MemberAdminService,
  ) {}

  @Post('open')
  @ApiOperation({ summary: '开卡：登记手机号并开一只余额为 0 的钱包。已开过卡返回 409' })
  open(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: OpenCardDto) {
    return this.cards.open(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: '查会员。完整手机号能查到任何门店开的卡；模糊查找限本店会员' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: MemberListQueryDto) {
    return this.cards.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '会员资料与全公司总余额' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.cards.get(actor, id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: '超级管理员改会员手机号或称呼。换号要写原因，旧手机上的会员小程序登录立即作废；有没签完的权益单时不能换号',
  })
  update(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.admin.update(actor, id, dto);
  }

  @Post(':id/disable')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '超级管理员停用会员：不能登录、不能记账（退余额除外），之前的登录立即作废' })
  disable(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string, @Body() dto: MemberStatusDto) {
    return this.admin.disable(actor, id, dto);
  }

  @Post(':id/enable')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '超级管理员恢复停用的会员。会员要重新登录' })
  enable(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string, @Body() dto: MemberStatusDto) {
    return this.admin.enable(actor, id, dto);
  }
}
