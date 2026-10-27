import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ScanPayCodeDto {
  @ApiProperty({ example: '868123456789012345', description: '摄像头扫到的内容，原样传' })
  @IsString({ message: '请扫顾客的会员码' })
  @IsNotEmpty({ message: '请扫顾客的会员码' })
  @MaxLength(512, { message: '这不是会员码，请扫顾客小程序里的会员码' })
  code!: string;

  @ApiProperty({ description: '在哪家门店扫的。之后扣款必须记在这家门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;
}
