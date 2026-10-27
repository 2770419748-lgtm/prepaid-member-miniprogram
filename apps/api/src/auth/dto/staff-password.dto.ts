import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class StaffPasswordLoginDto {
  @ApiProperty({ example: '13800138000', description: '11 位大陆手机号' })
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string;

  @ApiProperty({ description: '网页后台密码' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  password!: string;

  @ApiPropertyOptional({ description: '公司。只有一家在营公司时可以不填' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgId?: string;
}

export class ChangeStaffPasswordDto {
  @ApiProperty({ description: '当前密码。第一次修改时填写初始密码' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  currentPassword!: string;

  @ApiProperty({ description: '新密码，8 到 64 位，不能与当前密码相同', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword!: string;
}
