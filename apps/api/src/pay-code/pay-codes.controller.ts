import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { ScanPayCodeDto } from './dto/pay-code.dto';
import { PayCodeService } from './pay-code.service';

@ApiTags('会员码')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('pay-codes')
export class PayCodesController {
  constructor(private readonly payCodes: PayCodeService) {}

  @Post('scan')
  @HttpCode(200)
  @ApiOperation({
    summary: '店员扫会员码，返回会员和余额。之后 5 分钟内这位店员在这家门店可用这张码扣一次款',
  })
  scan(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: ScanPayCodeDto) {
    return this.payCodes.scan(actor, dto);
  }
}
