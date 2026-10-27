import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';

export class OpenCardDto {
  @ApiProperty({ example: '13800138000', description: '会员手机号。可带空格或 +86' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: '王女士', description: '称呼，可不填' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @ApiProperty({ description: '在哪家门店开卡。必须是操作人有权限的门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;
}

export class MemberListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: '13800138000',
    description: '完整 11 位手机号精确查找，任何门店的店员都能查到（余额全公司通用）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '8000', description: '手机号片段或称呼，模糊查找，限本店会员' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  keyword?: string;
}
