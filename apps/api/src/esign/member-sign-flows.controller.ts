import { Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals } from '../auth/decorators';
import { MemberSignFlowListQueryDto } from './dto/sign-flow.dto';
import { MemberSignFlowsService } from './member-sign-flows.service';

@ApiTags('会员')
@ApiBearerAuth()
@Principals('MEMBER')
@Controller('members/me')
export class MemberSignFlowsController {
  constructor(private readonly flows: MemberSignFlowsService) {}

  @Get('benefits')
  @ApiOperation({ summary: '我的权益：在用的权益方案，已签的排最前' })
  benefits(@CurrentPrincipal() principal: AccessPrincipal) {
    return this.flows.benefits(principal);
  }

  @Get('sign-flows')
  @ApiOperation({ summary: '我的权益单' })
  list(@CurrentPrincipal() principal: AccessPrincipal, @Query() query: MemberSignFlowListQueryDto) {
    return this.flows.list(principal, query);
  }

  @Get('sign-flows/:id')
  @ApiOperation({ summary: '一份权益单的详情和权益内容' })
  get(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string) {
    return this.flows.get(principal, id);
  }

  @Post('sign-flows/:id/sign-url')
  @ApiOperation({ summary: '取签署链接（H5）。只在待签署时可用，每次打开前重新取' })
  signUrl(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string) {
    return this.flows.signUrl(principal, id);
  }

  @Post('sign-flows/:id/refresh')
  @ApiOperation({ summary: '从签署页回来后同步状态' })
  refresh(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string) {
    return this.flows.refresh(principal, id);
  }

  @Get('sign-flows/:id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: '下载我签好的合同 PDF。还没归档时 404' })
  pdf(@CurrentPrincipal() principal: AccessPrincipal, @Param('id') id: string): Promise<StreamableFile> {
    return this.flows.pdf(principal, id);
  }
}
