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

/** 超级管理员修改会员资料。只填要改的项。 */
export class UpdateMemberDto {
  @ApiPropertyOptional({ example: '13900139000', description: '新手机号。换号后会员要用新号重新登录，旧手机上的登录立即作废' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '王女士', description: '称呼。传空字符串表示清掉' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ example: '顾客换号，本人到店出示身份证核对', description: '为什么改。换手机号时必填，写进操作记录' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class MemberStatusDto {
  @ApiProperty({ example: '顾客手机丢失，先停用', description: '为什么停用或恢复，必填，写进操作记录' })
  @IsString()
  @IsNotEmpty({ message: '请写明原因' })
  @MaxLength(200)
  reason!: string;
}
