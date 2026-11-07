import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from './page-query.dto';

export class StoreListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: StoreStatus, description: '营业状态' })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;
}

export class CreateStoreDto {
  @ApiProperty({ example: '旗舰店' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: '示例路 1 号', description: '详细地址' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: 31.230416, description: '纬度。和经度一起填' })
  @IsOptional()
  @IsLatitude()
  lat?: number | null;

  @ApiPropertyOptional({ example: 121.473701, description: '经度。和纬度一起填' })
  @IsOptional()
  @IsLongitude()
  lng?: number | null;

  @ApiPropertyOptional({ example: '021-12345678', description: '联系电话' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: '每天 10:00-22:00', description: '营业时间，原文' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessHours?: string;
}

export class UpdateStoreDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: '留空表示清掉地址' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ description: '纬度。清空时和经度一起传空', nullable: true })
  @IsOptional()
  @IsLatitude()
  lat?: number | null;

  @ApiPropertyOptional({ description: '经度。清空时和纬度一起传空', nullable: true })
  @IsOptional()
  @IsLongitude()
  lng?: number | null;

  @ApiPropertyOptional({ description: '联系电话。留空表示清掉' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ description: '营业时间。留空表示清掉' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessHours?: string;

  @ApiPropertyOptional({ enum: StoreStatus, description: '只有超级管理员能改营业状态' })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;
}

/** 一次最多导入这么多家门店。 */
export const STORE_IMPORT_MAX_ROWS = 200;

/** 表格里的一行。空格子不传；后台已有的同名门店，没传的项保持不变。 */
export class StoreImportRowDto {
  @ApiProperty({ example: '成都蜀都万达店' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: '成都市锦江区示例路 1 号 3 楼' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: '028-12345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: '每天 10:00-22:00' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessHours?: string;

  @ApiPropertyOptional({ example: 30.65718, description: '纬度（腾讯/高德地图坐标）。和经度一起传' })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 104.08081, description: '经度。和纬度一起传' })
  @IsOptional()
  @IsLongitude()
  lng?: number;
}

export class StoreImportDto {
  @ApiProperty({ description: 'true 只核对、列出会怎么处理，不写库；false 真正导入（有一行不对就整批不导）' })
  @IsBoolean()
  dryRun!: boolean;

  @ApiProperty({ type: [StoreImportRowDto] })
  @IsArray()
  @ArrayMinSize(1, { message: '表格里没有门店' })
  @ArrayMaxSize(STORE_IMPORT_MAX_ROWS, { message: `一次最多导入 ${STORE_IMPORT_MAX_ROWS} 家门店` })
  @ValidateNested({ each: true })
  @Type(() => StoreImportRowDto)
  rows!: StoreImportRowDto[];
}
