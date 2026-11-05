import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AccessPrincipal } from '../auth/access-principal';
import { CurrentPrincipal, Principals, Roles } from '../auth/decorators';
import { AddAgreementPhotosDto, CreatePaperAgreementDto, RemoveAgreementPhotoDto } from './dto/paper-agreement.dto';
import { PaperAgreementsService, UploadedPhotoFile } from './paper-agreements.service';

/**
 * multer 只在内存里收一个文件。上限放宽到 20MB，超过 8MB 的由服务里给中文提示（multer 自己的报错是英文）。
 * 正式环境 Caddy 入口限 10MB。
 */
const UPLOAD_OPTIONS = { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 } };

@ApiTags('权益单')
@ApiBearerAuth()
@Principals('STAFF')
@Roles('STAFF')
@Controller('sign-flows')
export class PaperAgreementsController {
  constructor(private readonly paper: PaperAgreementsService) {}

  @Post('photos')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: '传一张纸质协议单照片（JPG / PNG，≤ 8MB）。返回照片 id，交单或补传时带上',
  })
  upload(@CurrentPrincipal() actor: AccessPrincipal, @UploadedFile() file: UploadedPhotoFile | undefined) {
    return this.paper.uploadPhoto(actor, file);
  }

  @Post('paper')
  @ApiOperation({
    summary: '开单：上传顾客签字的纸质协议单，同时把会员权益金额充值到余额（坤总 2026-11-05 起代替电子签）',
  })
  create(@CurrentPrincipal() actor: AccessPrincipal, @Body() dto: CreatePaperAgreementDto) {
    return this.paper.create(actor, dto);
  }

  @Post(':id/photos')
  @ApiOperation({ summary: '给纸质协议单补传照片（本店员工、超管）' })
  addPhotos(@CurrentPrincipal() actor: AccessPrincipal, @Param('id') id: string, @Body() dto: AddAgreementPhotosDto) {
    return this.paper.addPhotos(actor, id, dto);
  }

  @Post(':id/photos/:photoId/remove')
  @ApiOperation({ summary: '删除照错的协议单照片（超管或开单门店店长，写原因，至少留一张）' })
  removePhoto(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() dto: RemoveAgreementPhotoDto,
  ) {
    return this.paper.removePhoto(actor, id, photoId, dto);
  }

  @Get(':id/photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: '查看一张协议单照片（本店员工、超管）' })
  photo(
    @CurrentPrincipal() actor: AccessPrincipal,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ): Promise<StreamableFile> {
    return this.paper.staffPhoto(actor, id, photoId);
  }
}
