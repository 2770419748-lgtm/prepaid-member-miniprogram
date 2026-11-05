import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { OrderCheckQueryDto } from './dto/ledger.dto';
import { OrderRedemptionService } from './order-redemption.service';

@ApiTags('记账')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('orders')
export class OrderController {
  constructor(private readonly orders: OrderRedemptionService) {}

  /** 只是提示用：真正拦住重复抵扣的是扣款时的数据库唯一索引。 */
  @Get('check')
  @ApiOperation({
    summary: '店员扫到订单码后先查一下：这张收银订单抵过没有（全公司范围）。返回整理后的订单号',
  })
  check(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: OrderCheckQueryDto) {
    return this.orders.check(actor.orgId, query.orderNo);
  }
}
