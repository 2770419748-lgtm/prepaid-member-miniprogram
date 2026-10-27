import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

/** 单笔金额上限：100 万元。防止把元当分、多按几个 0 之类的误录，也远离 Int 上限。 */
export const MAX_AMOUNT_CENT = 100_000_000;

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export class MoneyMoveDto {
  @ApiProperty({ description: '在哪家门店发生。必须是操作人有权限的门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiProperty({ example: 10000, description: '金额，单位分，正整数。100 元填 10000' })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENT)
  amountCent!: number;

  @ApiPropertyOptional({ example: '现金', description: '店内备注，会员端不显示' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;

  @ApiPropertyOptional({
    example: 'b0c6a1d2-7f3e-4c55-9a8e-1f2d3c4b5a69',
    description: '前端每次点「确认」生成一个。网络重试或重复点击带同一个号，只记一笔',
  })
  @IsOptional()
  @Matches(REQUEST_ID)
  requestId?: string;
}

export class ReversalDto {
  @ApiProperty({ example: '金额录错', description: '冲正原因，必填' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  remark!: string;

  @ApiPropertyOptional({ description: '防重复提交的请求号，同充值' })
  @IsOptional()
  @Matches(REQUEST_ID)
  requestId?: string;
}

export class LedgerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '只看这位会员。会员登录时只能是自己' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberId?: string;

  @ApiPropertyOptional({ description: '只看这家门店' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  @ApiPropertyOptional({ enum: LedgerType })
  @IsOptional()
  @IsEnum(LedgerType)
  type?: LedgerType;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00+08:00', description: '起始时间（含）' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+08:00', description: '结束时间（不含）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
