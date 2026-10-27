import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({ example: '示例路 1 号' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;
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

  @ApiPropertyOptional({ enum: StoreStatus, description: '只有超级管理员能改营业状态' })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;
}
