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
 * 店长无码抵扣（坤总 2026-11-07）：顾客出示不了会员码时，本店店长或超级管理员按手机号直接抵扣。
 * 不要会员码、九讯云单号选填；必须写原因；照样最多抵 10%、一单最多 1000 元，填了单号照样一单一抵。
 * 流水标成无码抵扣，操作记录单独一类，对账里拆得出来。
 * 流水和操作记录都删不掉，所以不清理测试数据；每次运行用一个新的组织。
 */
describe('codeless offset', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  const tokens = { super: '', managerA: '', managerB: '', clerkA: '' };
  const ids = { super: '', managerA: '', managerB: '', clerkA: '' };
  const phones = { super: randomPhone(), managerA: randomPhone(), managerB: randomPhone(), clerkA: randomPhone() };
  let seq = 0;
  const orderBase = randomInt(100_000_000, 900_000_000);

  function http() {
    return request(app.getHttpServer());
  }

  function freshOrder(): string {
    seq += 1;
    return `A${orderBase + seq}`;
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function memberWithBalance(balanceCent: number, storeId = storeA): Promise<string> {
    const opened = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ phone: randomPhone(), storeId: storeA });
    expect(opened.status).toBe(201);
    const recharge = await http()
      .post(`/wallets/${opened.body.id}/recharge`)
      .set('Authorization', `Bearer ${storeId === storeA ? tokens.managerA : tokens.managerB}`)
      .send({ storeId, amountCent: balanceCent, requestId: randomUUID() });
    expect(recharge.status).toBe(201);
    return opened.body.id as string;
  }

  interface CodelessBody {
    storeId: string;
    amountCent: number;
    productAmountCent?: number;
    orderNo?: string;
    orderNoTyped?: boolean;
    remark?: string;
    requestId?: string;
    payCode?: string;
  }

  function codeless(token: string, memberId: string, body: CodelessBody) {
    return http()
      .post(`/wallets/${memberId}/consume-codeless`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: randomUUID(), remark: '顾客没带手机', ...body });
  }

  async function balanceOf(memberId: string): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
  }

  async function memberToken(memberId: string): Promise<string> {
    const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    wechat.bind(`m-${member.phone}`, member.phone);
    const login = await http().post('/auth/member/wx-phone').send({ code: `m-${member.phone}`, phoneCode: 'p', orgId });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
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

    const org = await prisma.org.create({ data: { name: `无码抵扣测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '滨江店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '滨江店长', StaffRole.STORE_MANAGER, storeA],
      ['managerB', '社区店长', StaffRole.STORE_MANAGER, storeB],
      ['clerkA', '滨江店员', StaffRole.STAFF, storeA],
    ];
    for (const [key, name, role, storeId] of people) {
      const staff = await prisma.staff.create({
        data: { orgId, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      ids[key] = staff.id;
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('lets the store manager deduct without a member code or an order, and marks it everywhere', async () => {
    const memberId = await memberWithBalance(100_000);
    const response = await codeless(tokens.managerA, memberId, {
      storeId: storeA,
      amountCent: 12_990,
      productAmountCent: 129_900,
      remark: '  顾客没带手机  ',
    });
    expect(response.status).toBe(201);
    expect(response.body.balanceCent).toBe(87_010);
    expect(response.body.entry).toMatchObject({
      type: 'CONSUME',
      codeless: true,
      amountCent: 12_990,
      productAmountCent: 129_900,
      orderNo: null,
      orderNoTyped: null,
      remark: '顾客没带手机',
      operatorStaffId: ids.managerA,
      operatorName: '滨江店长',
      storeName: '滨江店',
    });
    expect(await balanceOf(memberId)).toBe(87_010);
    const entryId = response.body.entry.id as string;

    // 没有用掉任何会员码，也没有占单。
    expect(await prisma.memberPayCode.count({ where: { ledgerEntryId: entryId } })).toBe(0);
    expect(await prisma.orderRedemption.count({ where: { consumeEntryId: entryId } })).toBe(0);

    // 操作记录单独一类「无码抵扣」，带原因和操作人。
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, targetId: entryId } });
    expect(audit).toMatchObject({ action: 'WALLET_CONSUME_CODELESS', actorStaffId: ids.managerA, storeId: storeA });
    expect(audit.payloadJson).toMatchObject({
      codeless: true,
      remark: '顾客没带手机',
      amountCent: 12_990,
      productAmountCent: 129_900,
      balanceBefore: 100_000,
      balanceAfter: 87_010,
    });
    expect(audit.payloadJson).not.toHaveProperty('orderNo');
    const actions = await http().get('/audit-logs/actions').set('Authorization', `Bearer ${tokens.super}`);
    expect(actions.body).toEqual(expect.arrayContaining([{ action: 'WALLET_CONSUME_CODELESS', label: '无码抵扣' }]));
    const filtered = await http()
      .get('/audit-logs')
      .query({ action: 'WALLET_CONSUME_CODELESS', pageSize: 100 })
      .set('Authorization', `Bearer ${tokens.super}`);
    expect(filtered.body.items.map((item: { targetId: string }) => item.targetId)).toContain(entryId);

    // 会员自己的明细里也看得出这笔没扫会员码，但看不到操作人和原因。
    const token = await memberToken(memberId);
    const mine = await http().get(`/ledger/${entryId}`).set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ codeless: true, productAmountCent: 129_900, orderNo: null });
    expect(mine.body).not.toHaveProperty('remark');
    expect(mine.body).not.toHaveProperty('operatorName');
  });

  it('is only for the manager of that store and the super admin', async () => {
    const memberId = await memberWithBalance(50_000);
    const body = { storeId: storeA, amountCent: 1_000, productAmountCent: 10_000 };

    const clerk = await codeless(tokens.clerkA, memberId, body);
    expect(clerk.status).toBe(403);
    expect(messageOf(clerk.body)).toBe('无码抵扣只有本店店长和超级管理员能做；店员请扫顾客的会员码');

    // 别的门店的店长：不能记到滨江店，在自己店可以（余额全公司通用）。
    expect((await codeless(tokens.managerB, memberId, body)).status).toBe(403);
    const atOwnStore = await codeless(tokens.managerB, memberId, { ...body, storeId: storeB });
    expect(atOwnStore.status).toBe(201);
    expect(atOwnStore.body.entry).toMatchObject({ storeName: '社区店', codeless: true });

    // 超级管理员任一门店。
    const superB = await codeless(tokens.super, memberId, { ...body, storeId: storeB });
    expect(superB.status).toBe(201);
    expect(await balanceOf(memberId)).toBe(48_000);

    // 店员照旧可以扫码消费。
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const scanned = await http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ ...body, payCode, orderNo: freshOrder(), productAmountCent: 10_000, requestId: randomUUID() });
    expect(scanned.status).toBe(201);
    expect(scanned.body.entry.codeless).toBe(false);
  });

  it('requires a reason and a product amount, and keeps the 10% and 1000 yuan caps', async () => {
    const memberId = await memberWithBalance(500_000);
    const base = { storeId: storeA, amountCent: 1_000, productAmountCent: 10_000 };

    const noReason = await http()
      .post(`/wallets/${memberId}/consume-codeless`)
      .set('Authorization', `Bearer ${tokens.managerA}`)
      .send({ ...base, requestId: randomUUID() });
    expect(noReason.status).toBe(400);
    expect(messageOf(noReason.body)).toContain('请写明为什么没扫会员码');
    const blank = await codeless(tokens.managerA, memberId, { ...base, remark: '   ' });
    expect(blank.status).toBe(400);
    expect(messageOf(blank.body)).toContain('请写明为什么没扫会员码');

    const noProduct = await codeless(tokens.managerA, memberId, { storeId: storeA, amountCent: 1_000 });
    expect(noProduct.status).toBe(400);
    expect(messageOf(noProduct.body)).toContain('请填商品应付金额');

    const overTen = await codeless(tokens.managerA, memberId, { ...base, amountCent: 1_001 });
    expect(overTen.status).toBe(400);
    expect(messageOf(overTen.body)).toBe('这单最多只能抵 10.00 元（商品金额 100.00 元的 10%）');

    const overCap = await codeless(tokens.managerA, memberId, {
      storeId: storeA,
      amountCent: 100_001,
      productAmountCent: 2_000_000,
    });
    expect(overCap.status).toBe(400);
    expect(messageOf(overCap.body)).toBe('这单最多只能抵 1,000.00 元（一张单最多抵 1,000.00 元）');

    // 不收会员码字段，免得以为带了码就是扫码消费。
    const withCode = await codeless(tokens.managerA, memberId, { ...base, payCode: '868123456789012345' });
    expect(withCode.status).toBe(400);

    const badOrder = await codeless(tokens.managerA, memberId, { ...base, orderNo: '868123456789012' });
    expect(badOrder.status).toBe(400);

    expect(await balanceOf(memberId)).toBe(500_000);
    const atCap = await codeless(tokens.managerA, memberId, { ...base, amountCent: 1_000 });
    expect(atCap.status).toBe(201);
  });

  it('refuses disabled members and more than the balance', async () => {
    const memberId = await memberWithBalance(500);
    const short = await codeless(tokens.managerA, memberId, { storeId: storeA, amountCent: 600, productAmountCent: 6_000 });
    expect(short.status).toBe(400);
    expect(messageOf(short.body)).toBe('余额不足');

    await prisma.member.update({ where: { id: memberId }, data: { status: 'DISABLED' } });
    const disabled = await codeless(tokens.managerA, memberId, { storeId: storeA, amountCent: 100, productAmountCent: 1_000 });
    expect(disabled.status).toBe(400);
    expect(messageOf(disabled.body)).toBe('会员已停用，不能记账');
  });

  it('keeps one order one deduction when an order number is filled in, across scanned and codeless deductions', async () => {
    const memberId = await memberWithBalance(100_000);
    const orderNo = freshOrder();

    const first = await codeless(tokens.managerA, memberId, {
      storeId: storeA,
      amountCent: 5_000,
      productAmountCent: 50_000,
      orderNo: orderNo.slice(1),
      orderNoTyped: true,
    });
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({ orderNo, orderNoTyped: true, codeless: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, targetId: first.body.entry.id } });
    expect(audit.payloadJson).toMatchObject({ orderNo, orderNoTyped: true, codeless: true });

    // 同一张单：再无码抵一次不行，店员扫码抵也不行。
    const again = await codeless(tokens.managerB, memberId, {
      storeId: storeB,
      amountCent: 100,
      productAmountCent: 50_000,
      orderNo,
    });
    expect(again.status).toBe(409);
    expect(messageOf(again.body)).toContain('这张单已经抵扣过了');
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const scanned = await http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ storeId: storeA, amountCent: 100, payCode, orderNo, productAmountCent: 50_000, requestId: randomUUID() });
    expect(scanned.status).toBe(409);
    const checked = await http().get('/orders/check').query({ orderNo }).set('Authorization', `Bearer ${tokens.clerkA}`);
    expect(checked.body.redeemed).toMatchObject({ entryId: first.body.entry.id });

    // 店长冲正那笔无码抵扣：钱回来，单放开，可以重新抵。
    const reversal = await http()
      .post(`/ledger/${first.body.entry.id}/reversal`)
      .set('Authorization', `Bearer ${tokens.managerA}`)
      .send({ remark: '抵错人了', requestId: randomUUID() });
    expect(reversal.status).toBe(201);
    expect(reversal.body.entry).toMatchObject({ type: 'REVERSAL', codeless: false, orderNo });
    expect(await balanceOf(memberId)).toBe(100_000);
    const rescanned = await http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ storeId: storeA, amountCent: 100, payCode, orderNo, productAmountCent: 50_000, requestId: randomUUID() });
    expect(rescanned.status).toBe(201);
  });

  it('lets a codeless deduction without an order number be reversed', async () => {
    const memberId = await memberWithBalance(10_000);
    const spent = await codeless(tokens.managerA, memberId, { storeId: storeA, amountCent: 800, productAmountCent: 8_000 });
    expect(spent.status).toBe(201);
    const reversal = await http()
      .post(`/ledger/${spent.body.entry.id}/reversal`)
      .set('Authorization', `Bearer ${tokens.managerA}`)
      .send({ remark: '顾客后来出示了会员码', requestId: randomUUID() });
    expect(reversal.status).toBe(201);
    expect(reversal.body.entry).toMatchObject({ reversalOfType: 'CONSUME', orderNo: null });
    expect(await balanceOf(memberId)).toBe(10_000);
  });

  it('returns the first result for the same request, and refuses the same request number for a scanned deduction', async () => {
    const memberId = await memberWithBalance(10_000);
    const requestId = randomUUID();
    const body = { storeId: storeA, amountCent: 500, productAmountCent: 5_000, requestId };
    const [one, two] = await Promise.all([codeless(tokens.managerA, memberId, body), codeless(tokens.managerA, memberId, body)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    expect(one.body.entry.id).toBe(two.body.entry.id);
    expect([one.body.replayed, two.body.replayed].sort()).toEqual([false, true]);
    expect(await balanceOf(memberId)).toBe(9_500);

    // 同一个请求号拿去做扫码消费：是另一笔，拒绝。
    const payCode = await scanPayCode(app, orgId, tokens.managerA, memberId, storeA);
    const scanned = await http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${tokens.managerA}`)
      .send({ storeId: storeA, amountCent: 500, payCode, orderNo: freshOrder(), productAmountCent: 5_000, requestId });
    expect(scanned.status).toBe(409);
    expect(await balanceOf(memberId)).toBe(9_500);
  });

  it('can be listed on its own and is counted apart in the daily reconciliation', async () => {
    const memberId = await memberWithBalance(20_000);
    const spent = await codeless(tokens.managerA, memberId, { storeId: storeA, amountCent: 1_500, productAmountCent: 15_000 });
    expect(spent.status).toBe(201);
    const payCode = await scanPayCode(app, orgId, tokens.clerkA, memberId, storeA);
    const scanned = await http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ storeId: storeA, amountCent: 700, payCode, orderNo: freshOrder(), productAmountCent: 7_000, requestId: randomUUID() });
    expect(scanned.status).toBe(201);

    const only = await http()
      .get('/ledger')
      .query({ memberId, codeless: 'true' })
      .set('Authorization', `Bearer ${tokens.managerA}`);
    expect(only.status).toBe(200);
    expect(only.body.items.map((item: { id: string }) => item.id)).toEqual([spent.body.entry.id]);
    const without = await http()
      .get('/ledger')
      .query({ memberId, codeless: 'false', type: 'CONSUME' })
      .set('Authorization', `Bearer ${tokens.managerA}`);
    expect(without.body.items.map((item: { id: string }) => item.id)).toEqual([scanned.body.entry.id]);
    expect((await http().get('/ledger').query({ codeless: 'yes' }).set('Authorization', `Bearer ${tokens.managerA}`)).status).toBe(400);

    // 当日对账：无码抵扣算在消费里，另外单列笔数和金额。
    const entries = await prisma.ledgerEntry.findMany({ where: { orgId, storeId: storeA, type: 'CONSUME' } });
    const daily = await http().get('/reconciliation/daily').set('Authorization', `Bearer ${tokens.super}`);
    expect(daily.status).toBe(200);
    const a = daily.body.stores.find((store: { storeId: string }) => store.storeId === storeA);
    const codelessEntries = entries.filter((entry) => entry.codeless);
    expect(a).toMatchObject({
      consumeCount: entries.length,
      consumeCent: entries.reduce((sum, entry) => sum + entry.amountCent, 0),
      codelessCount: codelessEntries.length,
      codelessCent: codelessEntries.reduce((sum, entry) => sum + entry.amountCent, 0),
    });
    expect(a.codelessCount).toBeGreaterThan(0);
    expect(a.codelessCount).toBeLessThan(a.consumeCount);
    const overview = await http().get('/reconciliation/overview').set('Authorization', `Bearer ${tokens.managerA}`);
    expect(overview.status).toBe(200);
    expect(overview.body.today.codelessCount).toBe(a.codelessCount);
  });

  it('keeps the database honest: codeless only on consumes, always with a product amount and a reason', async () => {
    const memberId = await memberWithBalance(10_000);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
    const base = {
      orgId,
      memberId,
      walletId: wallet.id,
      storeId: storeA,
      balanceBefore: wallet.balanceCent,
      codeless: true,
    };
    // 无码抵扣没写原因。
    await expect(
      prisma.ledgerEntry.create({
        data: { ...base, type: 'CONSUME', amountCent: 100, balanceAfter: wallet.balanceCent - 100, productAmountCent: 1_000 },
      }),
    ).rejects.toThrow(/ledger_entries_codeless/);
    // 无码抵扣没填商品金额，封不住 10%。
    await expect(
      prisma.ledgerEntry.create({
        data: { ...base, type: 'CONSUME', amountCent: 100, balanceAfter: wallet.balanceCent - 100, remark: '没带手机' },
      }),
    ).rejects.toThrow(/ledger_entries_codeless/);
    // 充值不能标成无码抵扣。
    await expect(
      prisma.ledgerEntry.create({
        data: { ...base, type: 'RECHARGE', amountCent: 100, balanceAfter: wallet.balanceCent + 100, remark: '没带手机' },
      }),
    ).rejects.toThrow(/ledger_entries_codeless/);
    // 无码抵扣超过 10%、超过 1000 元。
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          type: 'CONSUME',
          amountCent: 101,
          balanceAfter: wallet.balanceCent - 101,
          productAmountCent: 1_000,
          remark: '没带手机',
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_fields/);
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          type: 'CONSUME',
          amountCent: 100_001,
          balanceBefore: 200_000,
          balanceAfter: 99_999,
          productAmountCent: 2_000_000,
          remark: '没带手机',
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_offset_cap/);
    // 扫码消费照旧必须带单号：只有商品金额、没单号的只能是无码抵扣。
    await expect(
      prisma.ledgerEntry.create({
        data: {
          ...base,
          codeless: false,
          type: 'CONSUME',
          amountCent: 100,
          balanceAfter: wallet.balanceCent - 100,
          productAmountCent: 1_000,
        },
      }),
    ).rejects.toThrow(/ledger_entries_order_fields/);
  });
});
