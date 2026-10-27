import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContractTemplateStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

const ESIGN_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class CreateContractTemplateDto {
  @ApiProperty({ description: 'e签宝里的文件模板 ID（沙箱）' })
  @IsString()
  @Matches(ESIGN_ID, { message: 'e签宝模板 ID 格式不对' })
  esignTemplateId!: string;

  @ApiProperty({ example: '储值会员权益单' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ description: '关联的权益方案' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  benefitPlanId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: 'DRAFT' | 'ACTIVE';

  @ApiPropertyOptional({ default: '会员签字', description: '合同里会员签名位置的关键字' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  memberSignKeyword?: string;

  @ApiPropertyOptional({ default: '商家盖章', description: '合同里商家盖章位置的关键字' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sealKeyword?: string;
}

export class UpdateContractTemplateDto {
  @ApiPropertyOptional({ description: '换绑 e签宝模板。会重新核对模板是否存在' })
  @IsOptional()
  @IsString()
  @Matches(ESIGN_ID, { message: 'e签宝模板 ID 格式不对' })
  esignTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: '传 null 取消关联' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  benefitPlanId?: string | null;

  @ApiPropertyOptional({ enum: ContractTemplateStatus, description: 'ARCHIVED 相当于停用，不删除' })
  @IsOptional()
  @IsEnum(ContractTemplateStatus)
  status?: ContractTemplateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  memberSignKeyword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sealKeyword?: string;
}

export class ContractTemplateListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ContractTemplateStatus })
  @IsOptional()
  @IsEnum(ContractTemplateStatus)
  status?: ContractTemplateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  benefitPlanId?: string;
}
