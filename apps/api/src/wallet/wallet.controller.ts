import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { ConsumeDto, MoneyMoveDto } from './dto/ledger.dto';
import { WalletService } from './wallet.service';

@ApiTags('记账')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Post(':memberId/recharge')
  @ApiOperation({ summary: '线下充值记账。只记账，不收款；门店须在操作人权限内' })
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
}
