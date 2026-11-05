import { Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { CancelSignFlowDto, CreateSignFlowDto, SignFlowListQueryDto } from './dto/sign-flow.dto';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_AGREEMENT } from './agreement-photo';
import { SignFlowsService } from './sign-flows.service';

@ApiTags('权益单')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('sign-flows')
export class SignFlowsController {
  constructor(private readonly flows: SignFlowsService) {}

  @Post()
  @ApiOperation({
    summary:
      '给会员发起电子签（会员个人签 + 商家企业章）。只在 SIGN_MODE=esign 时可用；正式签署开关关闭时只走沙箱',
  })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreateSignFlowDto) {
    return this.flows.create(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: '签署列表。超级管理员看全部，其他人只看本店发起的' })
  list(@CurrentPrincipal() actor: AccessPrincipal, @Query() query: SignFlowListQueryDto) {
    return this.flows.list(actor, query);
  }

  // 要写在 :id 前面，不然 config 会被当成权益单号。
  @Get('config')
  @ApiOperation({ summary: '现在开单怎么签：PAPER 上传纸质协议单（默认），ESIGN 电子签。附照片张数和大小上限' })
  config() {
    return { ...this.flows.config(), maxPhotos: MAX_PHOTOS_PER_AGREEMENT, maxPhotoBytes: MAX_PHOTO_BYTES };
  }

  @Get(':id')
  @ApiOperation({ summary: '查看一份签署' })
  get(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.flows.get(actor, id);
  }

  @Post(':id/refresh')
  @ApiOperation({
    summary: '到 e签宝核对状态；签完会把合同 PDF 存进对象存储。纸质协议单只补没充上的会员权益金额',
  })
  refresh(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.flows.refresh(actor, id);
  }

  @Post(':id/sign-url')
  @ApiOperation({ summary: '重新取会员签署链接（开单页画成二维码给顾客扫）。不是待签署 409' })
  signUrl(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string) {
    return this.flows.signUrl(actor, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '撤销待签署的权益单（超级管理员或发起门店店长）' })
  cancel(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Body() dto: CancelSignFlowDto,
  ) {
    return this.flows.cancel(actor, id, dto);
  }

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: '下载签好的合同 PDF。还没归档时 404' })
  pdf(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string): Promise<StreamableFile> {
    return this.flows.pdf(actor, id);
  }
}
