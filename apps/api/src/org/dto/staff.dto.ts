import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole, StaffStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from './page-query.dto';

export class StaffListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '只看这家门店的员工' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  storeId?: string;
}

export class CreateStaffDto {
  @ApiProperty({ example: '13800138000', description: '11 位大陆手机号' })
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string;

  @ApiProperty({ example: '张店长' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ description: '分配到哪家门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiProperty({ enum: StaffRole, description: '超级管理员、店长或店员。店长只能新建店员' })
  @IsEnum(StaffRole)
  role!: StaffRole;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ enum: StaffStatus })
  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;

  @ApiPropertyOptional({ description: '只有超级管理员能改手机号' })
  @IsOptional()
  @IsString()
  @Matches(/^1\d{10}$/)
  phone?: string;
}

export class RoleAssignmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiProperty({ enum: StaffRole })
  @IsEnum(StaffRole)
  role!: StaffRole;
}

export class ReplaceStaffRolesDto {
  @ApiProperty({
    type: [RoleAssignmentDto],
    description: '超级管理员用这份名单替换全部角色；店长只能改自己门店里的角色，且不能设成超级管理员',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles!: RoleAssignmentDto[];
}
