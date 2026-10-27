import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WxPhoneLoginDto {
  @ApiProperty({ description: '微信登录临时凭证', example: 'wx-login-code' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: '微信手机号授权凭证', example: 'wx-phone-code' })
  @IsString()
  @IsNotEmpty()
  phoneCode!: string;

  @ApiPropertyOptional({ description: '公司。只有一家在营公司时可以不填' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgId?: string;

  @ApiPropertyOptional({
    description: '仅开发演示。正式环境会忽略，不能当成真实登录',
    example: '13800138000',
  })
  @IsOptional()
  @IsString()
  mockPhone?: string;

  @ApiPropertyOptional({ description: '仅开发演示时的微信标识' })
  @IsOptional()
  @IsString()
  mockOpenId?: string;

  @ApiPropertyOptional({ description: '仅开发演示时的联合标识' })
  @IsOptional()
  @IsString()
  mockUnionId?: string;
}
