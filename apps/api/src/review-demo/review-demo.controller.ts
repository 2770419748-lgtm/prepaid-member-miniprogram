import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { ReviewDemoService } from './review-demo.service';

/** 商家后台「小程序审核入口」。只有超级管理员。小程序登录页用的两条在 /auth/review-demo。 */
@ApiTags('审核体验入口')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('SUPER_ADMIN')
@Controller('review-demo')
export class ReviewDemoController {
  constructor(private readonly reviewDemo: ReviewDemoService) {}

  @Get()
  @ApiOperation({ summary: '审核体验入口开着没有、开到什么时候、演示公司的情况' })
  status(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reviewDemo.status(actor);
  }

  @Post('open')
  @ApiOperation({
    summary: '打开审核体验入口 7 天（开着就从现在起再算 7 天），生成新密码，只在这次返回。第一次打开时建演示公司和假数据',
  })
  open(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reviewDemo.open(actor);
  }

  @Post('password')
  @ApiOperation({ summary: '开着的时候换一个审核密码，只在这次返回' })
  rotatePassword(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reviewDemo.rotatePassword(actor);
  }

  @Post('close')
  @ApiOperation({ summary: '关闭审核体验入口，审核员已有的登录马上失效。演示数据保留' })
  close(@CurrentPrincipal() actor: AccessPrincipal) {
    return this.reviewDemo.close(actor);
  }
}
