import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AccessPrincipal } from './access-principal';
import { AllowPendingPassword, CurrentPrincipal, Principals, Public } from './decorators';
import { ChangeStaffPasswordDto, StaffPasswordLoginDto } from './dto/staff-password.dto';
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

  @Post('member/session/renew')
  @Principals('MEMBER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '会员小程序续期登录：用还没过期的登录换一张新的，有效期重新算（默认 30 天）。会员被停用后换不了',
  })
  renewMemberSession(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.renewMemberSession(principal);
  }

  @Public()
  @Post('staff/wx-phone')
  @ApiOperation({ summary: '员工小程序用微信手机号登录' })
  loginStaff(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginStaff(dto);
  }

  @Public()
  @Post('staff/password/login')
  @ApiOperation({ summary: '网页后台员工登录（手机号和密码）' })
  loginStaffWithPassword(@Body() dto: StaffPasswordLoginDto) {
    return this.auth.loginStaffWithPassword(dto);
  }

  @Post('staff/session/renew')
  @Principals('STAFF')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '员工小程序续期登录：用还没过期的登录换一张新的，有效期重新算（默认 30 天）。停用、改密、重置密码后换不了。网页后台的密码登录不能续期',
  })
  renewStaffSession(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.renewStaffSession(principal);
  }

  @Post('staff/password/change')
  @Principals('STAFF')
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: '员工修改网页后台密码。第一次登录用初始密码换掉。改完之前的登录全部作废，要用新密码重新登录' })
  changeStaffPassword(@CurrentPrincipal() principal: AccessPrincipal, @Body() dto: ChangeStaffPasswordDto) {
    return this.auth.changeStaffPassword(principal, dto);
  }

  @Get('me')
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: '查看当前登录的是会员还是员工' })
  me(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.me(principal);
  }
}
