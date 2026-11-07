import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { CodelessConsumeDto, ConsumeDto, MoneyMoveDto, RefundDto } from './dto/ledger.dto';
import { WalletService } from './wallet.service';

@ApiTags('记账')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Post(':memberId/recharge')
  @ApiOperation({ summary: '直接充值记账（补录）。只记账，不收款；只有超级管理员和这家门店的店长能做，店员充值走开单' })
  recharge(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('memberId') memberId: string,
    @Body() dto: MoneyMoveDto,
  ) {
    return this.wallets.recharge(actor, memberId, dto);
  }

  @Post(':memberId/consume')
  @ApiOperation({
    summary: '消费扣款。必须带上刚扫到的会员码；余额不足时拒绝，同时扣同一张卡不会扣成负数',
  })
  consume(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('memberId') memberId: string,
    @Body() dto: ConsumeDto,
  ) {
    return this.wallets.consume(actor, memberId, dto);
  }

  /** 权限在服务里按门店判断（超级管理员，或这家门店的店长），这样店员能看到具体原因。 */
  @Post(':memberId/consume-codeless')
  @ApiOperation({
    summary:
      '无码抵扣：顾客出示不了会员码时，本店店长或超级管理员按手机号直接抵扣。不要会员码，九讯云单号选填；' +
      '必须写原因；照样最多抵商品金额的 10%、一单最多 1000 元，填了单号照样一单一抵',
  })
  consumeCodeless(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('memberId') memberId: string,
    @Body() dto: CodelessConsumeDto,
  ) {
    return this.wallets.consumeCodeless(actor, memberId, dto);
  }

  /** 权限在服务里按门店判断（超级管理员，或这家门店的店长），这样店员能看到具体原因。 */
  @Post(':memberId/refund')
  @ApiOperation({
    summary: '退余额记账：把会员没用完的储值退给顾客（钱线下退）。超级管理员或本店店长；必须写原因和退款方式；不能超过余额',
  })
  refund(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('memberId') memberId: string,
    @Body() dto: RefundDto,
  ) {
    return this.wallets.refund(actor, memberId, dto);
  }
}
