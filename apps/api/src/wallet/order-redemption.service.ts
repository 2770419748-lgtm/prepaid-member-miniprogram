import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatYuan } from '../common/money-words';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeOrderNo, ORDER_NO_MESSAGE } from './order-no';

/** 这张订单已经被哪一笔消费抵过（还没冲正）。 */
export interface OrderRedeemed {
  entryId: string;
  storeName: string;
  amountCent: number;
  productAmountCent: number | null;
  createdAt: string;
}

export interface OrderCheck {
  /** 整理后的订单号，如 A5982。 */
  orderNo: string;
  /** 没抵过为空。 */
  redeemed: OrderRedeemed | null;
  /** 抵过时给店员看的提示，和提交时被拦下的提示一样。没抵过为空。 */
  message: string | null;
}

const OFFSET_MS = 8 * 60 * 60 * 1000;

/** 「11月5日 14:32」，按上海时间。 */
function shortTime(at: Date): string {
  const local = new Date(at.getTime() + OFFSET_MS);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${local.getUTCMonth() + 1}月${local.getUTCDate()}日 ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** 店员看到的「已经抵过」提示，扫码时和提交时一样。 */
export function redeemedMessage(redeemed: OrderRedeemed): string {
  return (
    `这张单已经抵扣过了：${shortTime(new Date(redeemed.createdAt))} 在${redeemed.storeName}抵了 ` +
    `${formatYuan(redeemed.amountCent)} 元。一张单只能抵一次；抵错了请店长先把那笔冲正，再重新抵`
  );
}

/**
 * 订单抵扣占用：同一张收银订单在全公司只能抵一次。
 * 占用在扣款的同一事务里写（WalletService），冲正那笔消费时在冲正的事务里放开。
 * 真正的保证是数据库的部分唯一索引；这里的查询只是为了先给店员一个看得懂的提示。
 */
@Injectable()
export class OrderRedemptionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 整理订单号，不是订单号就报错。 */
  normalize(raw: string): string {
    const orderNo = normalizeOrderNo(raw);
    if (!orderNo) {
      throw new BadRequestException(ORDER_NO_MESSAGE);
    }
    return orderNo;
  }

  async check(orgId: string, raw: string): Promise<OrderCheck> {
    const orderNo = this.normalize(raw);
    const redeemed = await this.findActive(this.prisma, orgId, orderNo);
    return { orderNo, redeemed, message: redeemed ? redeemedMessage(redeemed) : null };
  }

  async findActive(
    db: Prisma.TransactionClient | PrismaService,
    orgId: string,
    orderNo: string,
  ): Promise<OrderRedeemed | null> {
    const active = await db.orderRedemption.findFirst({
      where: { orgId, orderNo, releasedAt: null },
      include: { consumeEntry: { include: { store: { select: { name: true } } } } },
    });
    if (!active) {
      return null;
    }
    const entry = active.consumeEntry;
    return {
      entryId: entry.id,
      storeName: entry.store.name,
      amountCent: entry.amountCent,
      productAmountCent: entry.productAmountCent,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  /** 没抵过就什么也不做；抵过了报「已经抵扣过」。 */
  async assertNotRedeemed(orgId: string, orderNo: string): Promise<void> {
    const redeemed = await this.findActive(this.prisma, orgId, orderNo);
    if (redeemed) {
      throw new ConflictException(redeemedMessage(redeemed));
    }
  }

  /** 扣款事务里占住这张订单。并发时第二笔会撞部分唯一索引（P2002），整笔回滚。 */
  async occupy(tx: Prisma.TransactionClient, orgId: string, orderNo: string, consumeEntryId: string): Promise<void> {
    await tx.orderRedemption.create({ data: { orgId, orderNo, consumeEntryId } });
  }

  /** 冲正事务里放开被冲那笔消费占着的订单。原流水没带订单号（2026-11-05 以前的消费、充值、退款）时什么也不做。 */
  async release(tx: Prisma.TransactionClient, consumeEntryId: string, reversalEntryId: string): Promise<void> {
    await tx.orderRedemption.updateMany({
      where: { consumeEntryId, releasedAt: null },
      data: { releasedAt: new Date(), releasedByEntryId: reversalEntryId },
    });
  }
}
