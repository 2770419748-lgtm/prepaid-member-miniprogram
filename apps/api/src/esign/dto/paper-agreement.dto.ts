import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_AMOUNT_CENT } from '../../wallet/dto/ledger.dto';
import { MAX_PHOTOS_PER_AGREEMENT } from '../agreement-photo';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class CreatePaperAgreementDto {
  @ApiProperty({ description: '哪位会员（要先开卡）' })
  @IsString()
  @IsNotEmpty()
  memberId!: string;

  @ApiProperty({ description: '在哪家门店开单。必须是操作人有权限、在营的门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiPropertyOptional({ description: '这份协议单对应的权益方案（启用中的）。不选也行' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  benefitPlanId?: string;

  @ApiProperty({
    example: 100000,
    description: '会员权益金额，单位分。上传协议单后立即充值到会员余额',
  })
  @IsInt({ message: '会员权益金额要是整数分' })
  @Min(1, { message: '会员权益金额要大于 0' })
  @Max(MAX_AMOUNT_CENT, { message: '会员权益金额单笔不能超过 100 万元' })
  rechargeAmountCent!: number;

  @ApiProperty({
    type: [String],
    description: `先用 POST /sign-flows/photos 一张张传上来的照片 id，1 到 ${MAX_PHOTOS_PER_AGREEMENT} 张`,
  })
  @IsArray()
  @ArrayMinSize(1, { message: '请至少上传一张协议单照片' })
  @ArrayMaxSize(MAX_PHOTOS_PER_AGREEMENT, { message: `协议单照片最多 ${MAX_PHOTOS_PER_AGREEMENT} 张` })
  @ArrayUnique({ message: '照片重复了' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  photoIds!: string[];

  @ApiProperty({ description: '防重复提交的请求号。网络不好重试时沿用同一个，只会开一单、充一次' })
  @Matches(REQUEST_ID, { message: '请求号格式不对' })
  requestId!: string;
}

export class AddAgreementPhotosDto {
  @ApiProperty({ type: [String], description: '刚传上来的照片 id' })
  @IsArray()
  @ArrayMinSize(1, { message: '请至少选一张照片' })
  @ArrayMaxSize(MAX_PHOTOS_PER_AGREEMENT, { message: `协议单照片最多 ${MAX_PHOTOS_PER_AGREEMENT} 张` })
  @ArrayUnique({ message: '照片重复了' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  photoIds!: string[];
}

export class RemoveAgreementPhotoDto {
  @ApiProperty({ example: '拍错了，不是这位顾客的协议单', description: '删除原因' })
  @IsString()
  @IsNotEmpty({ message: '请写明删除原因' })
  @MaxLength(100)
  reason!: string;
}
