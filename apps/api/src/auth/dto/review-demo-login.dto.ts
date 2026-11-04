import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** 小程序登录页「审核体验入口」。账号和密码在商家后台「小程序审核入口」里看。 */
export class ReviewDemoLoginDto {
  @ApiProperty({ example: 'shenhe', description: '审核账号' })
  @IsString()
  @IsNotEmpty({ message: '请填写审核账号' })
  @MaxLength(32)
  account!: string;

  @ApiProperty({ description: '审核密码，超级管理员打开入口时生成' })
  @IsString()
  @IsNotEmpty({ message: '请填写密码' })
  @MaxLength(64)
  password!: string;

  @ApiPropertyOptional({ description: '公司。只有一家在营公司时可以不填（小程序不填）' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgId?: string;
}

export class ReviewDemoQueryDto {
  @ApiPropertyOptional({ description: '公司。只有一家在营公司时可以不填（小程序不填）' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgId?: string;
}
