import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AccessPrincipal } from './access-principal';
import { CurrentPrincipal, Public } from './decorators';
import { WxPhoneLoginDto } from './dto/wx-phone-login.dto';

@ApiTags('登录')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('member/wx-phone')
  @ApiOperation({ summary: '会员用微信手机号登录' })
  loginMember(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginMember(dto);
  }

  @Public()
  @Post('staff/wx-phone')
  @ApiOperation({ summary: '员工用微信手机号登录' })
  loginStaff(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginStaff(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '查看当前登录的是会员还是员工' })
  me(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.me(principal);
  }
}
