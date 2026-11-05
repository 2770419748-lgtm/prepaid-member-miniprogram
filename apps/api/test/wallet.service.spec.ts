import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogWriter } from '../src/audit/audit-log.writer';
import type { AccessPrincipal } from '../src/auth/access-principal';
import type { PayCodeService } from '../src/pay-code/pay-code.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { OrderRedemptionService } from '../src/wallet/order-redemption.service';
import { WalletService } from '../src/wallet/wallet.service';

const clerk: AccessPrincipal = {
  sub: 'staff-1',
  orgId: 'org-1',
  principalType: 'STAFF',
  roles: [{ storeId: 'store-1', role: 'STAFF' }],
};

interface FakeWallet {
  id: string;
  balanceCent: number;
  version: number;
}

/** 只模拟 WalletService 用到的几个 Prisma 调用。updateMany 的结果由测试控制，用来制造版本冲突。 */
function fakePrisma(wallet: FakeWallet, updateCounts: number[] = [], activeOrder: unknown = null) {
  const created: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const occupied: Record<string, unknown>[] = [];
  const released: Record<string, unknown>[] = [];
  let transactions = 0;
  const tx = {
    wallet: {
      findUnique: jest.fn(() => Promise.resolve({ ...wallet })),
      updateMany: jest.fn((args: { where: { version: number }; data: { balanceCent: number } }) => {
        if (updateCounts.shift() === 0) {
          // 模拟另一笔请求抢先改了这只钱包。
          wallet.version += 1;
          return Promise.resolve({ count: 0 });
        }
        if (args.where.version !== wallet.version) {
          return Promise.resolve({ count: 0 });
        }
        wallet.balanceCent = args.data.balanceCent;
        wallet.version += 1;
        return Promise.resolve({ count: 1 });
      }),
    },
    ledgerEntry: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        const row = {
          id: `entry-${created.length + 1}`,
          ...args.data,
          createdAt: new Date('2026-10-27T10:00:00Z'),
          member: { phone: '13800000001', name: null },
          store: { name: '旗舰店' },
          operator: { name: '店员' },
          reversedBy: null,
        };
        created.push(row);
        return Promise.resolve(row);
      }),
    },
    auditLog: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
    orderRedemption: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        occupied.push(args.data);
        return Promise.resolve(args.data);
      }),
      updateMany: jest.fn((args: Record<string, unknown>) => {
        released.push(args);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const prisma = {
    store: { findUnique: jest.fn(() => Promise.resolve({ id: 'store-1', orgId: 'org-1', status: 'ACTIVE' })) },
    member: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 'member-1', orgId: 'org-1', status: 'ACTIVE', wallet: { id: wallet.id } }),
      ),
    },
    ledgerEntry: { findUnique: jest.fn(() => Promise.resolve(null)) },
    orderRedemption: { findFirst: jest.fn(() => Promise.resolve(activeOrder)) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return fn(tx);
    }),
  };
  return {
    prisma: prisma as unknown as PrismaService,
    tx,
    created,
    audits,
    occupied,
    released,
    transactions: () => transactions,
  };
}

/** 会员码在 pay-code 集成测试里单独测。这里只确认扣款会先查码、并在同一事务里把码标成已用。 */
function fakePayCodes(options: { usable?: boolean; markFails?: boolean } = {}) {
  const used: { payCodeId: string; ledgerEntryId: string }[] = [];
  const service = {
    assertUsable: jest.fn(() =>
      options.usable === false
        ? Promise.reject(new BadRequestException('请先扫顾客的会员码'))
        : Promise.resolve({ id: 'code-1' }),
    ),
    markUsed: jest.fn((_tx: unknown, payCodeId: string, _staff: string, _store: string, ledgerEntryId: string) => {
      if (options.markFails) {
        return Promise.reject(new ConflictException('会员码已失效，请顾客刷新会员码后重新扫'));
      }
      used.push({ payCodeId, ledgerEntryId });
      return Promise.resolve();
    }),
  };
  return { service: service as unknown as PayCodeService, raw: service, used };
}

/** 消费都要带会员码和收银订单：商品 1000 元，最多抵 100 元。 */
const scanned = { payCode: '800000000000000000', orderNo: 'A5982', productAmountCent: 100_000 };
/** 充值、扣款、冲正都必须带请求号。 */
const req = { requestId: 'request-0001' };

describe('WalletService', () => {
  it('writes the wallet, the ledger entry and the audit record in one transaction', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 0, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    const result = await service.recharge(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 10000 });
    expect(result.balanceCent).toBe(10000);
    expect(fake.transactions()).toBe(1);
    expect(fake.tx.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: 'wallet-1', version: 0 },
      data: { balanceCent: 10000, version: { increment: 1 } },
    });
    expect(fake.created[0]).toMatchObject({
      type: 'RECHARGE',
      amountCent: 10000,
      balanceBefore: 0,
      balanceAfter: 10000,
      operatorStaffId: 'staff-1',
      storeId: 'store-1',
    });
    expect(fake.audits[0]).toMatchObject({ action: 'WALLET_RECHARGE', targetId: 'entry-1' });
  });

  it('refuses to overdraw and writes nothing', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 500, version: 3 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    await expect(service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 501, ...scanned })).rejects.toThrow(
      BadRequestException,
    );
    expect(fake.tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(fake.created).toHaveLength(0);
    expect(wallet).toEqual({ id: 'wallet-1', balanceCent: 500, version: 3 });
  });

  it('re-reads and retries when someone else changed the wallet first', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet, [0, 0]);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    const result = await service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 300, ...scanned });
    expect(fake.transactions()).toBe(3);
    expect(result.balanceCent).toBe(700);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({ balanceBefore: 1000, balanceAfter: 700 });
  });

  it('gives up with 409 when the wallet keeps changing underneath', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet, Array.from({ length: 20 }, () => 0));
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    await expect(service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 300, ...scanned })).rejects.toThrow(
      ConflictException,
    );
    expect(fake.created).toHaveLength(0);
    expect(fake.transactions()).toBe(8);
  });

  it('checks the member code first and marks it used inside the deduction transaction', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet);
    const codes = fakePayCodes();
    const service = new WalletService(fake.prisma, new AuditLogWriter(), codes.service, new OrderRedemptionService(fake.prisma));
    await service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 300, ...scanned });
    expect(codes.raw.assertUsable).toHaveBeenCalledWith(clerk, 'member-1', 'store-1', scanned.payCode);
    expect(codes.raw.markUsed).toHaveBeenCalledWith(fake.tx, 'code-1', 'staff-1', 'store-1', 'entry-1');
    expect(fake.audits[0]).toMatchObject({ action: 'WALLET_CONSUME', payloadJson: { payCodeId: 'code-1' } });
  });

  it('does not deduct without a usable member code', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes({ usable: false }).service, new OrderRedemptionService(fake.prisma));
    await expect(
      service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 300, ...scanned }),
    ).rejects.toThrow('请先扫顾客的会员码');
    expect(fake.transactions()).toBe(0);
  });

  it('fails the whole deduction when the code was used up in the meantime', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes({ markFails: true }).service, new OrderRedemptionService(fake.prisma));
    await expect(
      service.consume(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 300, ...scanned }),
    ).rejects.toThrow(ConflictException);
    // 真实数据库里整笔回滚；这里确认没有走到写操作记录。
    expect(fake.audits).toHaveLength(0);
  });

  it('never asks for a member code when recharging', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 0, version: 0 };
    const fake = fakePrisma(wallet);
    const codes = fakePayCodes();
    const service = new WalletService(fake.prisma, new AuditLogWriter(), codes.service, new OrderRedemptionService(fake.prisma));
    await service.recharge(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 100 });
    expect(codes.raw.assertUsable).not.toHaveBeenCalled();
    expect(codes.raw.markUsed).not.toHaveBeenCalled();
  });

  it('checks the store scope before touching anything', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 1000, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    await expect(
      service.recharge(clerk, 'member-1', { ...req, storeId: 'store-2', amountCent: 100 }),
    ).rejects.toThrow('无权操作该门店');
    expect(fake.transactions()).toBe(0);
  });

  it('refuses to deduct more than 10% of the order before touching anything', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 100_000, version: 0 };
    const fake = fakePrisma(wallet);
    const codes = fakePayCodes();
    const service = new WalletService(fake.prisma, new AuditLogWriter(), codes.service, new OrderRedemptionService(fake.prisma));
    await expect(
      service.consume(clerk, 'member-1', { ...req, ...scanned, storeId: 'store-1', productAmountCent: 239_900, amountCent: 23_991 }),
    ).rejects.toThrow('这单最多只能抵 239.90 元（商品金额 2,399.00 元的 10%）');
    expect(codes.raw.assertUsable).not.toHaveBeenCalled();
    expect(fake.transactions()).toBe(0);
  });

  it('deducts exactly 10% and occupies the order inside the deduction transaction', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 100_000, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(
      fake.prisma,
      new AuditLogWriter(),
      fakePayCodes().service,
      new OrderRedemptionService(fake.prisma),
    );
    const result = await service.consume(clerk, 'member-1', {
      ...req,
      ...scanned,
      storeId: 'store-1',
      orderNo: ' 05982 ',
      orderNoTyped: true,
      productAmountCent: 239_900,
      amountCent: 23_990,
    });
    expect(result.balanceCent).toBe(76_010);
    expect(fake.created[0]).toMatchObject({ orderNo: 'A5982', productAmountCent: 239_900, orderNoTyped: true });
    expect(fake.occupied).toEqual([{ orgId: 'org-1', orderNo: 'A5982', consumeEntryId: 'entry-1' }]);
    expect(fake.audits[0]).toMatchObject({
      action: 'WALLET_CONSUME',
      payloadJson: { orderNo: 'A5982', productAmountCent: 239_900, orderNoTyped: true },
    });
  });

  it('says where and when an order was already used, without deducting', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 100_000, version: 0 };
    const active = {
      consumeEntry: {
        id: 'entry-old',
        amountCent: 23_990,
        productAmountCent: 239_900,
        createdAt: new Date('2026-11-05T06:32:00Z'),
        store: { name: '滨江店' },
      },
    };
    const fake = fakePrisma(wallet, [], active);
    const codes = fakePayCodes();
    const service = new WalletService(fake.prisma, new AuditLogWriter(), codes.service, new OrderRedemptionService(fake.prisma));
    await expect(
      service.consume(clerk, 'member-1', { ...req, ...scanned, storeId: 'store-1', amountCent: 1_000 }),
    ).rejects.toThrow('这张单已经抵扣过了：11月5日 14:32 在滨江店抵了 239.90 元');
    expect(codes.raw.assertUsable).not.toHaveBeenCalled();
    expect(fake.transactions()).toBe(0);
  });

  it('never occupies an order when recharging', async () => {
    const wallet = { id: 'wallet-1', balanceCent: 0, version: 0 };
    const fake = fakePrisma(wallet);
    const service = new WalletService(fake.prisma, new AuditLogWriter(), fakePayCodes().service, new OrderRedemptionService(fake.prisma));
    await service.recharge(clerk, 'member-1', { ...req, storeId: 'store-1', amountCent: 100 });
    expect(fake.created[0]).toMatchObject({ orderNo: null, productAmountCent: null, orderNoTyped: null });
    expect(fake.occupied).toHaveLength(0);
  });
});
