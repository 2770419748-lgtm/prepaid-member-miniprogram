import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class DailyReconciliationQueryDto {
  @ApiPropertyOptional({ example: '2026-10-27', description: '哪一天（上海时间）。不填为今天' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ description: '只看这家门店' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;
}
