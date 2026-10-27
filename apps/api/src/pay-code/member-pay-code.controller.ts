import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals } from '../auth/decorators';
import { PayCodeService } from './pay-code.service';

@ApiTags('会员码')
@ApiBearerAuth()
@Principals('MEMBER')
@Controller('members/me/pay-code')
export class MemberPayCodeController {
  constructor(private readonly payCodes: PayCodeService) {}

  @Post()
  @ApiOperation({ summary: '取一张新会员码（到店消费时出示）。1 分钟内有效、只能用一次，之前没被扫的码同时作废' })
  issue(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.payCodes.issue(principal);
  }

  @Get(':id')
  @ApiOperation({ summary: '这张会员码现在怎样了：等待扫码、门店已扫、已扣款（带那一笔）或已过期' })
  status(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string) {
    return this.payCodes.statusForMember(principal, id);
  }
}
