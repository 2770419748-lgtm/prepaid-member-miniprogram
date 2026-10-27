import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

export class AuditLogQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'WALLET_RECHARGE', description: '操作类型，见 GET /audit-logs/actions' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ description: '只看这位员工做的' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  actorStaffId?: string;

  @ApiPropertyOptional({ description: '只看发生在这家门店的' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  @ApiPropertyOptional({ example: 'LedgerEntry', description: '对象类型：Member / LedgerEntry / Store / Staff / SignFlow' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  targetType?: string;

  @ApiPropertyOptional({ description: '对象 ID，例如某条流水或某位会员' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetId?: string;

  @ApiPropertyOptional({ example: '2026-10-27T00:00:00+08:00', description: '起始时间（含）' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-28T00:00:00+08:00', description: '结束时间（不含）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
