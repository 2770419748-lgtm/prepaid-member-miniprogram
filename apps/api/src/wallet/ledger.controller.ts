import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals } from '../auth/decorators';
import { LedgerQueryDto, ReversalDto } from './dto/ledger.dto';
import { LedgerService } from './ledger.service';
import { WalletService } from './wallet.service';

@ApiTags('流水')
@ApiBearerAuth()
@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
  ) {}

  @Get()
  @Principals('STAFF', 'MEMBER')
  @ApiOperation({ summary: '查流水。会员只看自己的；店员只看本店发生的；超级管理员看全公司' })
  list(@CurrentPrincipal() principal: AccessPrincipal, @Query() query: LedgerQueryDto) {
    return this.ledger.list(principal, query);
  }

  @Get(':id')
  @Principals('STAFF', 'MEMBER')
  @ApiOperation({ summary: '一条流水的详情' })
  get(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string) {
    return this.ledger.get(principal, id);
  }

  /** 权限在服务里按原流水的门店判断，这样店员能看到具体原因。 */
  @Post(':id/reversal')
  @Principals('STAFF')
  @ApiOperation({ summary: '冲正：整笔冲回一条记错的充值或消费。超级管理员或原门店店长；每条只能冲一次' })
  reverse(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: ReversalDto,
  ) {
    return this.wallets.reverse(actor, id, dto);
  }
}
