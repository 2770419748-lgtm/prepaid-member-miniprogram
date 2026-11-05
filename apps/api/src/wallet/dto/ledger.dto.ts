import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerType } from '@prisma/client';
import {
  IsBoolean,
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
  ValidationArguments,
} from 'class-validator';
import { PageQueryDto } from '../../org/dto/page-query.dto';
import { ORDER_NO_INPUT_PATTERN, ORDER_NO_MESSAGE } from '../order-no';

/** 单笔金额上限：100 万元。防止把元当分、多按几个 0 之类的误录，也远离 Int 上限。 */
export const MAX_AMOUNT_CENT = 100_000_000;

/**
 * 防重复提交的请求号。充值、扣款、冲正都必须带：同一个号提交几次都只记一笔，返回第一次的结果。
 * 不让漏带，免得绕过页面直接调接口时连点记成两笔。
 */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const requestIdMessage = (args: ValidationArguments) =>
  args.value === undefined || args.value === null || args.value === ''
    ? '缺少防重复提交的请求号 requestId'
    : '请求号 requestId 要 8 到 64 位字母、数字、- 或 _';

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

  @ApiProperty({
    example: 'b0c6a1d2-7f3e-4c55-9a8e-1f2d3c4b5a69',
    description: '必填。前端每次点「确认」生成一个。网络重试或重复点击带同一个号，只记一笔',
  })
  @Matches(REQUEST_ID, { message: requestIdMessage })
  requestId!: string;
}

export class ConsumeDto extends MoneyMoveDto {
  @ApiProperty({
    example: '868123456789012345',
    description:
      '刚扫到的会员码（顾客会员小程序里的二维码，先调 POST /pay-codes/scan）。' +
      '扫码的店员在扫码的门店、5 分钟内可用，只能用一次',
  })
  @IsString({ message: '请先扫顾客的会员码' })
  @IsNotEmpty({ message: '请先扫顾客的会员码' })
  @MaxLength(64, { message: '会员码不对，请重新扫码' })
  payCode!: string;

  @ApiProperty({
    example: 'A5982',
    description:
      '必填。抵扣的是收银系统（九讯云）哪张订单：扫小票上的订单条码读到的内容（A5982），' +
      '或店员照小票手输的单号（5982）。服务端统一整理成 A+数字；同一张单全公司只能抵一次，冲正后可以重新抵',
  })
  @IsString({ message: '请先扫九讯云小票上的订单码' })
  @Matches(ORDER_NO_INPUT_PATTERN, { message: ORDER_NO_MESSAGE })
  orderNo!: string;

  @ApiPropertyOptional({ example: false, description: '订单号是手输的（条码扫不出来时）。默认 false：扫码读到的' })
  @IsOptional()
  @IsBoolean()
  orderNoTyped?: boolean;

  @ApiProperty({
    example: 239900,
    description: '必填。这张订单的商品应付金额（小票「总计」减优惠），单位分。本次抵扣 amountCent 不能超过它的 10%',
  })
  @IsInt({ message: '请填商品应付金额' })
  @Min(1, { message: '商品应付金额要大于 0' })
  @Max(MAX_AMOUNT_CENT, { message: '商品应付金额不能超过 100 万元' })
  productAmountCent!: number;
}

/** 退余额：把会员没用完的储值退给顾客。钱在店里线下退（现金、转账等），这里只记账。 */
export class RefundDto {
  @ApiProperty({ description: '在哪家门店办理。超级管理员任一门店；店长只能是自己管的门店' })
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @ApiProperty({ example: 25000, description: '退多少，单位分，正整数，不能超过当前余额。全部退就填当前余额' })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENT)
  amountCent!: number;

  @ApiProperty({ example: '顾客搬家，现金退回', description: '必填：为什么退、钱怎么退给顾客。会员端不显示' })
  @IsString()
  @IsNotEmpty({ message: '请写明退款原因和退款方式' })
  @MaxLength(200)
  remark!: string;

  @ApiProperty({ description: '必填。防重复提交的请求号，同充值' })
  @Matches(REQUEST_ID, { message: requestIdMessage })
  requestId!: string;
}

export class ReversalDto {
  @ApiProperty({ example: '金额录错', description: '冲正原因，必填' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  remark!: string;

  @ApiProperty({ description: '必填。防重复提交的请求号，同充值' })
  @Matches(REQUEST_ID, { message: requestIdMessage })
  requestId!: string;
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

  @ApiPropertyOptional({ example: '5982', description: '只看抵扣这张订单的流水（带不带 A 都行）' })
  @IsOptional()
  @Matches(ORDER_NO_INPUT_PATTERN, { message: ORDER_NO_MESSAGE })
  orderNo?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00+08:00', description: '起始时间（含）' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00+08:00', description: '结束时间（不含）' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class OrderCheckQueryDto {
  @ApiProperty({ example: 'A5982', description: '扫到或手输的订单号' })
  @IsString({ message: ORDER_NO_MESSAGE })
  @Matches(ORDER_NO_INPUT_PATTERN, { message: ORDER_NO_MESSAGE })
  orderNo!: string;
}
