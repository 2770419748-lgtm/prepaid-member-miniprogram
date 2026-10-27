import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals } from '../auth/decorators';
import { MembersService } from './members.service';

@ApiTags('会员')
@ApiBearerAuth()
@Principals('MEMBER')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('me')
  @ApiOperation({ summary: '查看我的会员资料。不含余额，开卡以后再补' })
  me(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.members.me(principal);
  }
}
