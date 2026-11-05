import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';
import { scanPayCode } from './support/pay-code';

/**
 * 扫订单码抵扣（坤总 2026-11-05）：消费必须带收银订单号和商品应付金额，最多抵商品金额的 10%，
 * 同一张订单全公司只能抵一次；冲正那笔消费后放开，可以重新抵。
 * 流水和占用记录都删不掉，所以不清理测试数据；每次运行用一个新的组织。
 */
describe('order offset', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let otherOrgId = '';
  let storeA = '';
  let storeB = '';
  const tokens = { clerkA: '', clerkB: '', managerA: '', managerB: '', otherClerk: '', otherManager: '' };
  const phones = {
    clerkA: randomPhone(),
    clerkB: randomPhone(),
    managerA: randomPhone(),
    managerB: randomPhone(),
    otherClerk: randomPhone(),
    otherManager: randomPhone(),
  };
  let otherStore = '';
  let seq = 0;
  const orderBase = randomInt(100_000_000, 900_000_000);

  function http() {
    return request(app.getHttpServer());
  }

  /** 每个用例一张没用过的单号，免得用例之间互相占单。 */
  function freshOrder(): string {
    seq += 1;
    return `A${orderBase + seq}`;
  }

  async function staffLogin(code: string, org: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId: org });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  /** 店员开卡，这家店的店长补录充值（店员不能直接充值，只能走开单）。 */
  async function memberWithBalance(balanceCent: number, token = tokens.clerkA, storeId = storeA): Promise<string> {
    const opened = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: randomPhone(), storeId });
    expect(opened.status).toBe(201);
    const manager = storeId === storeA ? tokens.managerA : storeId === storeB ? tokens.managerB : tokens.otherManager;
    const recharge = await http()
      .post(`/wallets/${opened.body.id}/recharge`)
      .set('Authorization', `Bearer ${manager}`)
      .send({ storeId, amountCent: balanceCent, requestId: randomUUID() });
    expect(recharge.status).toBe(201);
    return opened.body.id as string;
  }

  interface ConsumeBody {
    storeId: string;
    amountCent: number;
    orderNo?: string;
    productAmountCent?: number;
    orderNoTyped?: boolean;
    payCode?: string;
    requestId?: string;
  }

  /** 没给会员码时替这位店员扫一张；并发用例先扫好码再同时提交。 */
  async function consume(token: string, memberId: string, body: ConsumeBody, org = orgId) {
    const payCode = body.payCode ?? (await scanPayCode(app, org, token, memberId, body.storeId));
    return http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: randomUUID(), ...body, payCode });
  }

  function reverse(token: string, entryId: string) {
    return http()
      .post(`/ledger/${entryId}/reversal`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remark: '抵错单了', requestId: randomUUID() });
  }

  function check(token: string, orderNo: string) {
    return http().get('/orders/check').query({ orderNo }).set('Authorization', `Bearer ${token}`);
  }

  async function balanceOf(memberId: string): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
  }

  beforeAll(async () => {
    process.env.WECHAT_MEMBER_APPID = 'test-member-app';
    process.env.WECHAT_MEMBER_SECRET = 'test-member-secret';
    process.env.WECHAT_PHONE_MOCK = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatPhoneClient)
      .useValue(wechat)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const org = await prisma.org.create({ data: { name: `订单抵扣测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '滨江店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    const other = await prisma.org.create({ data: { name: `别的公司${Date.now()}`, status: 'ACTIVE' } });
    otherOrgId = other.id;
    otherStore = (await prisma.store.create({ data: { orgId: otherOrgId, name: '别家店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string, string][] = [
      ['clerkA', '滨江店员', StaffRole.STAFF, storeA, orgId],
      ['clerkB', '社区店员', StaffRole.STAFF, storeB, orgId],
      ['managerA', '滨江店长', StaffRole.STORE_MANAGER, storeA, orgId],
      ['managerB', '社区店长', StaffRole.STORE_MANAGER, storeB, orgId],
      ['otherClerk', '别家店员', StaffRole.STAFF, otherStore, otherOrgId],
      ['otherManager', '别家店长', StaffRole.STORE_MANAGER, otherStore, otherOrgId],
    ];
    for (const [key, name, role, storeId, org] of people) {
      await prisma.staff.create({
        data: { orgId: org, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key, org);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('deducts up to 10% of the order and records the order on the entry, the audit log and both ledger views', async () => {
    const memberId = await memberWithBalance(288_000);
    const spent = await consume(tokens.clerkA, memberId, {
      storeId: storeA,
      amountCent: 23_990,
      orderNo: 'A5982',
      productAmountCent: 239_900,
    });
    expect(spent.status).toBe(201);
    expect(spent.body).toMatchObject({
      balanceCent: 264_010,
      entry: { type: 'CONSUME', amountCent: 23_990, orderNo: 'A5982', productAmountCent: 239_900, orderNoTyped: false },
    });
    const entryId = spent.body.entry.id as string;

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, targetId: entryId } });
    expect(audit.payloadJson).toMatchObject({ orderNo: 'A5982', productAmountCent: 239_900 });

    const memberToken = await (async () => {
      const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
      wechat.bind(`m-${member.phone}`, member.phone);
      const login = await http().post('/auth/member/wx-phone').send({ code: `m-${member.phone}`, phoneCode: 'p', orgId });
      return login.body.accessToken as string;
    })();
    const mine = await http().get(`/ledger/${entryId}`).set('Authorization', `Bearer ${memberToken}`);
    expect(mine.body).toMatchObject({ orderNo: 'A5982', productAmountCent: 239_900 });
    expect(mine.body).not.toHaveProperty('orderNoTyped');
    expect(mine.body).not.toHaveProperty('operatorName');
  });

  it('refuses a cent over 10% and keeps the member code for another try', async () => {
    const memberId = await memberWithBalance(100_000);
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const orderNo = freshOrder();
    const over = await consume(tokens.clerkA, memberId, {
      storeId: storeA,
      amountCent: 23_991,
      orderNo,
      productAmountCent: 239_900,
      payCode,
    });
    expect(over.status).toBe(400);
    expect(messageOf(over.body)).toBe('这单最多只能抵 239.90 元（商品金额 2,399.00 元的 10%）');
    expect(await balanceOf(memberId)).toBe(100_000);
    // 码还在，改成能抵的金额再交一次就行。
    const ok = await consume(tokens.clerkA, memberId, {
      storeId: storeA,
      amountCent: 23_990,
      orderNo,
      productAmountCent: 239_900,
      payCode,
    });
    expect(ok.status).toBe(201);
  });

  it('caps one order at 1000 yuan even when 10% of it is more', async () => {
    const memberId = await memberWithBalance(300_000);
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const orderNo = freshOrder();
    // 15,999 元的单，10% 是 1,599.90 元，只能抵 1,000 元。
    const order = { storeId: storeA, orderNo, productAmountCent: 1_599_900, payCode };
    const over = await consume(tokens.clerkA, memberId, { ...order, amountCent: 100_001 });
    expect(over.status).toBe(400);
    expect(messageOf(over.body)).toBe('这单最多只能抵 1,000.00 元（一张单最多抵 1,000.00 元）');
    expect(await balanceOf(memberId)).toBe(300_000);
    const ok = await consume(tokens.clerkA, memberId, { ...order, amountCent: 100_000 });
    expect(ok.status).toBe(201);
    expect(await balanceOf(memberId)).toBe(200_000);
  });

  it('requires an order number and a product amount, and only accepts order numbers', async () => {
    const memberId = await memberWithBalance(10_000);
    const missing = await consume(tokens.clerkA, memberId, { storeId: storeA, amountCent: 100 });
    expect(missing.status).toBe(400);
    expect(messageOf(missing.body)).toContain('请先扫九讯云小票上的订单码');
    expect(messageOf(missing.body)).toContain('请填商品应付金额');
    // 手机串号（15 位）、商品 69 码（13 位）、二维码网址、全 0 都不是订单号。
    for (const orderNo of ['860242083947116', '6942785121867', 'https://example.com/A5982', 'A0000', 'B5982']) {
      const wrong = await consume(tokens.clerkA, memberId, {
        storeId: storeA,
        amountCent: 100,
        orderNo,
        productAmountCent: 1_000,
      });
      expect(wrong.status).toBe(400);
      expect(messageOf(wrong.body)).toContain('订单号不对');
    }
    expect(await balanceOf(memberId)).toBe(10_000);
  });

  it('lets one order be used once across the whole company, however the number was written', async () => {
    const first = await memberWithBalance(50_000);
    const second = await memberWithBalance(50_000, tokens.clerkB, storeB);
    const digits = freshOrder().slice(1);
    const used = await consume(tokens.clerkA, first, {
      storeId: storeA,
      amountCent: 1_000,
      orderNo: `A${digits}`,
      productAmountCent: 10_000,
    });
    expect(used.status).toBe(201);

    // 别的店、别的会员、手输不带 A、带前导 0、小写：都是同一张单。
    for (const orderNo of [digits, `0${digits}`, `a${digits}`, ` A${digits} `]) {
      const again = await consume(tokens.clerkB, second, {
        storeId: storeB,
        amountCent: 500,
        orderNo,
        orderNoTyped: true,
        productAmountCent: 10_000,
      });
      expect(again.status).toBe(409);
      expect(messageOf(again.body)).toMatch(/^这张单已经抵扣过了：\d+月\d+日 \d{2}:\d{2} 在滨江店抵了 10\.00 元/);
    }
    expect(await balanceOf(second)).toBe(50_000);

    // 扫码时先查一下，提示一样。
    const checked = await check(tokens.clerkB, digits);
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({
      orderNo: `A${digits}`,
      redeemed: { entryId: used.body.entry.id, storeName: '滨江店', amountCent: 1_000, productAmountCent: 10_000 },
    });
    const blocked = await consume(tokens.clerkB, second, {
      storeId: storeB,
      amountCent: 500,
      orderNo: digits,
      productAmountCent: 10_000,
    });
    expect(checked.body.message).toBe(messageOf(blocked.body));
    expect((await check(tokens.clerkB, freshOrder())).body).toMatchObject({ redeemed: null, message: null });
    expect((await check(tokens.clerkB, '860242083947116')).status).toBe(400);
  });

  it('keeps orders apart between companies', async () => {
    const orderNo = freshOrder();
    const ours = await memberWithBalance(10_000);
    expect((await consume(tokens.clerkA, ours, { storeId: storeA, amountCent: 100, orderNo, productAmountCent: 1_000 })).status).toBe(201);
    const theirs = await memberWithBalance(10_000, tokens.otherClerk, otherStore);
    const elsewhere = await consume(
      tokens.otherClerk,
      theirs,
      { storeId: otherStore, amountCent: 100, orderNo, productAmountCent: 1_000 },
      otherOrgId,
    );
    expect(elsewhere.status).toBe(201);
    expect((await check(tokens.otherClerk, orderNo)).body.redeemed.storeName).toBe('别家店');
  });

  it('frees the order when the deduction is reversed, so it can be deducted again', async () => {
    const memberId = await memberWithBalance(50_000);
    const orderNo = freshOrder();
    const wrong = await consume(tokens.clerkA, memberId, {
      storeId: storeA,
      amountCent: 2_000,
      orderNo,
      productAmountCent: 20_000,
    });
    expect(wrong.status).toBe(201);
    const reversal = await reverse(tokens.managerA, wrong.body.entry.id as string);
    expect(reversal.status).toBe(201);
    // 冲正流水显示被冲那笔的订单号，对账时能对上。
    expect(reversal.body.entry).toMatchObject({ type: 'REVERSAL', orderNo, productAmountCent: null });
    expect((await check(tokens.clerkA, orderNo)).body.redeemed).toBeNull();

    const redo = await consume(tokens.clerkA, memberId, {
      storeId: storeA,
      amountCent: 1_500,
      orderNo,
      productAmountCent: 15_000,
    });
    expect(redo.status).toBe(201);
    expect((await check(tokens.clerkA, orderNo)).body.redeemed).toMatchObject({ entryId: redo.body.entry.id });

    const rows = await prisma.orderRedemption.findMany({ where: { orgId, orderNo }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ consumeEntryId: wrong.body.entry.id, releasedByEntryId: reversal.body.entry.id });
    expect(rows[0].releasedAt).not.toBeNull();
    expect(rows[1]).toMatchObject({ consumeEntryId: redo.body.entry.id, releasedAt: null });

    // 按订单号查流水：抵扣、冲正、重新抵扣三笔都在。手输的写法也认。
    const listed = await http()
      .get('/ledger')
      .query({ orderNo: orderNo.slice(1) })
      .set('Authorization', `Bearer ${tokens.managerA}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((entry: { id: string }) => entry.id).sort()).toEqual(
      [wrong.body.entry.id, reversal.body.entry.id, redo.body.entry.id].sort(),
    );
  });

  it('lets only one of two phones deduct the same order at the same moment', async () => {
    const first = await memberWithBalance(10_000);
    const second = await memberWithBalance(10_000, tokens.clerkB, storeB);
    const codeA = await scanPayCode(app, orgId, tokens.clerkA, first, storeA);
    const codeB = await scanPayCode(app, orgId, tokens.clerkB, second, storeB);
    const orderNo = freshOrder();
    const results = await Promise.all([
      consume(tokens.clerkA, first, { storeId: storeA, amountCent: 800, orderNo, productAmountCent: 8_000, payCode: codeA }),
      consume(tokens.clerkB, second, { storeId: storeB, amountCent: 800, orderNo, productAmountCent: 8_000, payCode: codeB }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const loser = results.find((result) => result.status === 409)!;
    expect(messageOf(loser.body)).toContain('这张单已经抵扣过了');
    expect((await balanceOf(first)) + (await balanceOf(second))).toBe(19_200);
    expect(await prisma.orderRedemption.count({ where: { orgId, orderNo } })).toBe(1);
    // 没抵成的那位，会员码还能用。
    const loserMember = results[0].status === 409 ? first : second;
    expect(await prisma.memberPayCode.count({ where: { memberId: loserMember, status: 'SCANNED' } })).toBe(1);
  });

  it('returns the first result when the same request is sent twice, and refuses the same request number for another order', async () => {
    const memberId = await memberWithBalance(10_000);
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const requestId = randomUUID();
    const orderNo = freshOrder();
    const body = { storeId: storeA, amountCent: 300, orderNo, productAmountCent: 3_000, payCode, requestId };
    const [one, two] = await Promise.all([consume(tokens.clerkA, memberId, body), consume(tokens.clerkA, memberId, body)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body.entry.id).toBe(two.body.entry.id);
    expect([one.body.replayed, two.body.replayed].sort()).toEqual([false, true]);
    const later = await consume(tokens.clerkA, memberId, body);
    expect(later.status).toBe(201);
    expect(later.body.replayed).toBe(true);
    const otherOrder = await consume(tokens.clerkA, memberId, { ...body, orderNo: freshOrder() });
    expect(otherOrder.status).toBe(409);
    expect(messageOf(otherOrder.body)).toBe('这个请求号已经用于另一笔记账');
    expect(await balanceOf(memberId)).toBe(9_700);
  });

  it('keeps the database honest: no order on recharges, no deducting over 10% or 1000 yuan, no deleting or rewriting redemptions', async () => {
    const memberId = await memberWithBalance(10_000);
    const orderNo = freshOrder();
    const spent = await consume(tokens.clerkA, memberId, { storeId: storeA, amountCent: 100, orderNo, productAmountCent: 1_000 });
    expect(spent.status).toBe(201);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
    const base = {
      orgId,
      memberId,
      walletId: wallet.id,
      storeId: storeA,
      balanceBefore: wallet.balanceCent,
    };
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          type: 'RECHARGE',
          amountCent: 100,
          balanceAfter: wallet.balanceCent + 100,
          orderNo: freshOrder(),
          productAmountCent: 1_000,
          orderNoTyped: false,
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_fields/);
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          type: 'CONSUME',
          amountCent: 101,
          balanceAfter: wallet.balanceCent - 101,
          orderNo: freshOrder(),
          productAmountCent: 1_000,
          orderNoTyped: false,
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_fields/);
    // 10% 够了，但一张单最多 1000 元。
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          type: 'CONSUME',
          amountCent: 100_001,
          balanceBefore: 200_000,
          balanceAfter: 99_999,
          orderNo: freshOrder(),
          productAmountCent: 2_000_000,
          orderNoTyped: false,
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_offset_cap/);

    const row = await prisma.orderRedemption.findFirstOrThrow({ where: { orgId, orderNo } });
    await expect(prisma.orderRedemption.delete({ where: { id: row.id } })).rejects.toThrow(/not allowed/);
    await expect(
      prisma.orderRedemption.update({ where: { id: row.id }, data: { orderNo: freshOrder() } }),
    ).rejects.toThrow(/only released_at/);
    await expect(
      prisma.orderRedemption.create({ data: { orgId, orderNo, consumeEntryId: spent.body.entry.id } }),
    ).rejects.toThrow();
  });
});
