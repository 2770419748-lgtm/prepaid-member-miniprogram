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
  @Post('wx-phone')
  @ApiOperation({
    summary:
      '小程序微信手机号登录（会员和员工共用一个小程序）：手机号是本公司在职员工就返回员工登录（principalType=STAFF，直接进工作台），否则按会员登录（principalType=MEMBER）',
  })
  login(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginWithWechatPhone(dto);
  }

  @Public()
  @Post('member/wx-phone')
  @ApiOperation({ summary: '只按会员登录（脚本和测试用；小程序用 POST /auth/wx-phone）' })
  loginMember(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginMember(dto);
  }

  @Post('member/session/renew')
  @Principals('MEMBER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '小程序会员登录续期：用还没过期的登录换一张新的，有效期重新算（默认 30 天）。会员被停用后换不了',
  })
  renewMemberSession(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.renewMemberSession(principal);
  }

  @Public()
  @Post('staff/wx-phone')
  @ApiOperation({ summary: '只按员工登录，不是员工就拒绝（脚本和测试用；小程序用 POST /auth/wx-phone）' })
  loginStaff(@Body() dto: WxPhoneLoginDto) {
    return this.auth.loginStaff(dto);
  }

  @Post('staff/member-session')
  @Principals('STAFF')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '工作台「切到我的会员卡」：用员工本人的手机号换一张会员登录（没有会员就建）。只认小程序微信手机号登录的员工',
  })
  memberSessionForStaff(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.auth.memberSessionForStaff(principal);
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
      '小程序员工登录续期：用还没过期的登录换一张新的，有效期重新算（默认 30 天）。停用、改密、重置密码后换不了。网页后台的密码登录不能续期',
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
