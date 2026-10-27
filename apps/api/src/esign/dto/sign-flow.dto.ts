import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignFlowStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class CreateSignFlowDto {
  @ApiProperty({ description: '给哪位会员发起' })
  @IsString()
  @IsNotEmpty()
  memberId!: string;

  @ApiProperty({ description: '用哪份权益单模板，必须是启用状态' })
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @ApiProperty({ description: '在哪家门店发起。必须是操作人有权限的门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiPropertyOptional({ description: '防重复提交的请求号。重复提交返回第一次的结果' })
  @IsOptional()
  @Matches(REQUEST_ID)
  requestId?: string;
}

export class CancelSignFlowDto {
  @ApiProperty({ example: '发错模板', description: '撤销原因' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reason!: string;
}

export class SignFlowListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SignFlowStatus })
  @IsOptional()
  @IsEnum(SignFlowStatus)
  status?: SignFlowStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  templateId?: string;

  @ApiPropertyOptional({ description: '发起门店' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;
}

export class MemberSignFlowListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SignFlowStatus })
  @IsOptional()
  @IsEnum(SignFlowStatus)
  status?: SignFlowStatus;
}
