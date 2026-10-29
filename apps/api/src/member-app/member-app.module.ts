import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MemberAppController } from './member-app.controller';
import { MemberAppCodeService } from './member-app-code.service';

/** 会员小程序码：员工小程序开单完成后弹给顾客扫，打开会员小程序登录。 */
@Module({
  imports: [AuthModule],
  controllers: [MemberAppController],
  providers: [MemberAppCodeService],
})
export class MemberAppModule {}
