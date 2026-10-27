import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { MemberListQueryDto, OpenCardDto } from './dto/member-card.dto';
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
  constructor(private readonly cards: MemberCardsService) {}

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
}
