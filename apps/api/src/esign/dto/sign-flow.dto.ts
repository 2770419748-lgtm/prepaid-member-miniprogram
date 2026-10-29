import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignFlowStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';
import { MAX_AMOUNT_CENT } from '../../wallet/dto/ledger.dto';

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

  @ApiPropertyOptional({
    example: 100000,
    description:
      '会员权益金额，单位分。店员开单时填，写进合同；会员签完后自动充值到余额（签完才到账）。' +
      '会员必须已开卡。不填就是不带金额的权益单',
  })
  @IsOptional()
  @IsInt({ message: '会员权益金额要是整数分' })
  @Min(1, { message: '会员权益金额要大于 0' })
  @Max(MAX_AMOUNT_CENT, { message: '会员权益金额单笔不能超过 100 万元' })
  rechargeAmountCent?: number;
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
