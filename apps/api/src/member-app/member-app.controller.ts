import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Principals, Roles } from '../auth/decorators';
import { MemberAppCodeService } from './member-app-code.service';

@ApiTags('会员小程序码')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('member-app')
export class MemberAppController {
  constructor(private readonly codes: MemberAppCodeService) {}

  @Get('code')
  @ApiOperation({
    summary: '会员小程序码（开单完成后给顾客扫码登录）。拿不到时 image 为空，message 说明原因；本机演示 demo=true',
  })
  code() {
    return this.codes.code();
  }
}
