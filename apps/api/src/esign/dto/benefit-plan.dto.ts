import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BenefitPlanStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

export class BenefitItemDto {
  @ApiProperty({ example: '全场护理 9 折', description: '一条权益，会员首页最多展示前 3 条' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  title!: string;

  @ApiPropertyOptional({ example: '限本人使用，不与其他优惠同享' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

export class CreateBenefitPlanDto {
  @ApiProperty({ example: '储值会员权益' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title!: string;

  @ApiPropertyOptional({ example: '储值后在全部门店通用' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @ApiProperty({ type: [BenefitItemDto], description: '权益条目，1 到 20 条' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BenefitItemDto)
  items!: BenefitItemDto[];

  @ApiPropertyOptional({ example: '储值终身有效，用完为止。', description: '适用规则全文' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rules?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: 'DRAFT' | 'ACTIVE';
}

export class UpdateBenefitPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ description: '传空串清空' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @ApiPropertyOptional({ type: [BenefitItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BenefitItemDto)
  items?: BenefitItemDto[];

  @ApiPropertyOptional({ description: '传空串清空' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rules?: string;

  @ApiPropertyOptional({ enum: BenefitPlanStatus, description: 'ARCHIVED 相当于下架，不删除' })
  @IsOptional()
  @IsEnum(BenefitPlanStatus)
  status?: BenefitPlanStatus;
}

export class BenefitPlanListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BenefitPlanStatus })
  @IsOptional()
  @IsEnum(BenefitPlanStatus)
  status?: BenefitPlanStatus;
}
