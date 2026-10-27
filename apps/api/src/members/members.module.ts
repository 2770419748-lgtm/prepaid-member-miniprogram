import { Module } from '@nestjs/common';
import { MemberCardsController } from './member-cards.controller';
import { MemberCardsService } from './member-cards.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

/** 顺序有意义：会员自己的固定路由先注册，店员侧的 /members/:id 后注册。 */
@Module({
  controllers: [MembersController, MemberCardsController],
  providers: [MembersService, MemberCardsService],
})
export class MembersModule {}
