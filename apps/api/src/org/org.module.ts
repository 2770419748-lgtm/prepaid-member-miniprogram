import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

/** 门店与员工。谁能看、谁能改，按登录身份和门店角色判断。 */
@Module({
  controllers: [StoresController, StaffController],
  providers: [StoresService, StaffService],
})
export class OrgModule {}
