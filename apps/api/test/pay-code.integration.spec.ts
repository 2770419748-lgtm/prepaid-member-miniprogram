import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { hashPayCode } from '../src/pay-code/pay-code';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';

/**
 * 扫会员码消费：会员出示会员码 → 店员扫码 → 填金额扣款。
 * 不扫码不能扣款；码只能用一次、很快过期、只归扫码的店员在扫码的门店用。
 * 流水和用过的码都删不掉，所以不清理测试数据；每次运行用一个新的组织。
 */
describe('member pay code', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  const tokens = { clerkA: '', clerkA2: '', clerkB: '', managerA: '' };
  const phones = { clerkA: randomPhone(), clerkA2: randomPhone(), clerkB: randomPhone(), managerA: randomPhone() };

  function http() {
    return request(app.getHttpServer());
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  /** 店员开卡、充值，会员登录小程序。返回会员 id 和会员的登录凭证。 */
  async function memberWithBalance(balanceCent: number): Promise<{ id: string; token: string }> {
    const phone = randomPhone();
    const opened = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ phone, storeId: storeA });
    expect(opened.status).toBe(201);
    if (balanceCent > 0) {
      const recharge = await http()
        .post(`/wallets/${opened.body.id}/recharge`)
        .set('Authorization', `Bearer ${tokens.clerkA}`)
        .send({ storeId: storeA, amountCent: balanceCent });
      expect(recharge.status).toBe(201);
    }
    const code = `member-${phone}`;
    wechat.bind(code, phone);
    const login = await http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(login.status).toBe(201);
    return { id: opened.body.id as string, token: login.body.accessToken as string };
  }

  function issue(memberToken: string) {
    return http().post('/members/me/pay-code').set('Authorization', `Bearer ${memberToken}`);
  }

  function statusOf(memberToken: string, id: string) {
    return http().get(`/members/me/pay-code/${id}`).set('Authorization', `Bearer ${memberToken}`);
  }

  function scan(token: string, code: string, storeId: string) {
    return http().post('/pay-codes/scan').set('Authorization', `Bearer ${token}`).send({ code, storeId });
  }

  function consume(
    token: string,
    memberId: string,
    body: { storeId: string; amountCent: number; payCode?: string; requestId?: string },
  ) {
    return http().post(`/wallets/${memberId}/consume`).set('Authorization', `Bearer ${token}`).send(body);
  }

  beforeAll(async () => {
    process.env.WECHAT_MEMBER_APPID = 'test-member-app';
    process.env.WECHAT_MEMBER_SECRET = 'test-member-secret';
    process.env.WECHAT_STAFF_APPID = 'test-staff-app';
    process.env.WECHAT_STAFF_SECRET = 'test-staff-secret';
    process.env.WECHAT_PHONE_MOCK = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatPhoneClient)
      .useValue(wechat)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const org = await prisma.org.create({ data: { name: `会员码测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['clerkA', '旗舰店员', StaffRole.STAFF, storeA],
      ['clerkA2', '旗舰店员二', StaffRole.STAFF, storeA],
      ['clerkB', '社区店员', StaffRole.STAFF, storeB],
      ['managerA', '旗舰店长', StaffRole.STORE_MANAGER, storeA],
    ];
    for (const [key, name, role, storeId] of people) {
      await prisma.staff.create({
        data: { orgId, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('runs the whole flow: show code, scan, deduct, and the member sees the result', async () => {
    const member = await memberWithBalance(10_000);
    const issued = await issue(member.token);
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({ refreshAfterSeconds: 30 });
    expect(issued.body.code).toMatch(/^8\d{17}$/);
    const ttl = new Date(issued.body.expiresAt as string).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    // 库里只有哈希，没有码本身。
    const row = await prisma.memberPayCode.findUniqueOrThrow({ where: { id: issued.body.id } });
    expect(row.codeHash).toBe(hashPayCode(issued.body.code));
    expect(JSON.stringify(row)).not.toContain(issued.body.code);

    expect((await statusOf(member.token, issued.body.id)).body).toMatchObject({ status: 'ACTIVE', storeName: null });

    const scanned = await scan(tokens.clerkA, ` ${issued.body.code} `, storeA);
    expect(scanned.status).toBe(200);
    expect(scanned.body.member).toMatchObject({ id: member.id, balanceCent: 10_000, hasCard: true });
    const claim = new Date(scanned.body.expiresAt as string).getTime() - Date.now();
    expect(claim).toBeGreaterThan(4 * 60_000);
    expect((await statusOf(member.token, issued.body.id)).body).toMatchObject({
      status: 'SCANNED',
      storeName: '旗舰店',
    });

    const spent = await consume(tokens.clerkA, member.id, {
      storeId: storeA,
      amountCent: 3_000,
      payCode: issued.body.code,
    });
    expect(spent.status).toBe(201);
    expect(spent.body).toMatchObject({ balanceCent: 7_000, entry: { type: 'CONSUME', amountCent: 3_000 } });

    const seen = await statusOf(member.token, issued.body.id);
    expect(seen.body).toMatchObject({
      status: 'USED',
      storeName: '旗舰店',
      entry: { id: spent.body.entry.id, type: 'CONSUME', changeCent: -3_000, balanceAfter: 7_000 },
    });
    // 会员看到的这一笔不含操作人和备注。
    expect(seen.body.entry).not.toHaveProperty('operatorName');
    expect(seen.body.entry).not.toHaveProperty('remark');

    const used = await prisma.memberPayCode.findUniqueOrThrow({ where: { id: issued.body.id } });
    expect(used).toMatchObject({ status: 'USED', ledgerEntryId: spent.body.entry.id });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, targetId: spent.body.entry.id } });
    expect(audit.payloadJson).toMatchObject({ payCodeId: issued.body.id });
  });

  it('refuses to deduct without a scanned code', async () => {
    const member = await memberWithBalance(5_000);
    const none = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 100 });
    expect(none.status).toBe(400);
    expect(messageOf(none.body)).toContain('请先扫顾客的会员码');

    const issued = await issue(member.token);
    const notScanned = await consume(tokens.clerkA, member.id, {
      storeId: storeA,
      amountCent: 100,
      payCode: issued.body.code,
    });
    expect(notScanned.status).toBe(400);
    expect(messageOf(notScanned.body)).toContain('请先扫顾客的会员码');

    const made = await consume(tokens.clerkA, member.id, {
      storeId: storeA,
      amountCent: 100,
      payCode: '800000000000000000',
    });
    expect(made.status).toBe(400);
    expect(await prisma.ledgerEntry.count({ where: { memberId: member.id, type: 'CONSUME' } })).toBe(0);
  });

  it('uses a code only once', async () => {
    const member = await memberWithBalance(5_000);
    const { body } = await issue(member.token);
    await scan(tokens.clerkA, body.code, storeA);
    const first = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 1_000, payCode: body.code });
    expect(first.status).toBe(201);

    const again = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 1_000, payCode: body.code });
    expect(again.status).toBe(409);
    expect(messageOf(again.body)).toContain('已经用过了');
    const rescan = await scan(tokens.clerkA, body.code, storeA);
    expect(rescan.status).toBe(409);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { memberId: member.id } })).balanceCent).toBe(4_000);
  });

  it('still replays a retried deduction with the same request number after the code is used', async () => {
    const member = await memberWithBalance(5_000);
    const { body } = await issue(member.token);
    await scan(tokens.clerkA, body.code, storeA);
    const requestId = randomUUID();
    const first = await consume(tokens.clerkA, member.id, {
      storeId: storeA,
      amountCent: 800,
      payCode: body.code,
      requestId,
    });
    const retry = await consume(tokens.clerkA, member.id, {
      storeId: storeA,
      amountCent: 800,
      payCode: body.code,
      requestId,
    });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ replayed: true, entry: { id: first.body.entry.id } });
  });

  it('lets only one of two simultaneous deductions with the same code through', async () => {
    const member = await memberWithBalance(5_000);
    const { body } = await issue(member.token);
    await scan(tokens.clerkA, body.code, storeA);
    const results = await Promise.all(
      [700, 900].map((amountCent) =>
        consume(tokens.clerkA, member.id, { storeId: storeA, amountCent, payCode: body.code }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await prisma.ledgerEntry.count({ where: { memberId: member.id, type: 'CONSUME' } })).toBe(1);
  });

  it('keeps the code after a failed deduction so the cashier can fix the amount', async () => {
    const member = await memberWithBalance(1_000);
    const { body } = await issue(member.token);
    await scan(tokens.clerkA, body.code, storeA);
    const tooMuch = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 1_500, payCode: body.code });
    expect(tooMuch.status).toBe(400);
    expect(messageOf(tooMuch.body)).toContain('余额不足');
    const fixed = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 1_000, payCode: body.code });
    expect(fixed.status).toBe(201);
    expect(fixed.body.balanceCent).toBe(0);
  });

  it('belongs to the cashier who scanned it, at the store where it was scanned', async () => {
    const member = await memberWithBalance(5_000);
    const { body } = await issue(member.token);
    expect((await scan(tokens.clerkA, body.code, storeA)).status).toBe(200);
    // 重扫（例如网络断了）给同样的结果。
    expect((await scan(tokens.clerkA, body.code, storeA)).status).toBe(200);

    const otherClerk = await scan(tokens.clerkA2, body.code, storeA);
    expect(otherClerk.status).toBe(409);
    expect(messageOf(otherClerk.body)).toContain('已经被扫过了');
    const otherStore = await scan(tokens.clerkB, body.code, storeB);
    expect(otherStore.status).toBe(409);

    const byOther = await consume(tokens.clerkA2, member.id, { storeId: storeA, amountCent: 100, payCode: body.code });
    expect(byOther.status).toBe(403);
    const byManager = await consume(tokens.managerA, member.id, { storeId: storeA, amountCent: 100, payCode: body.code });
    expect(byManager.status).toBe(403);
    expect(await prisma.ledgerEntry.count({ where: { memberId: member.id, type: 'CONSUME' } })).toBe(0);
  });

  it('cannot be used to deduct from somebody else', async () => {
    const owner = await memberWithBalance(5_000);
    const other = await memberWithBalance(5_000);
    const { body } = await issue(owner.token);
    await scan(tokens.clerkA, body.code, storeA);
    const wrong = await consume(tokens.clerkA, other.id, { storeId: storeA, amountCent: 100, payCode: body.code });
    expect(wrong.status).toBe(400);
    expect(messageOf(wrong.body)).toContain('不是这位会员的');
    expect(await prisma.ledgerEntry.count({ where: { memberId: other.id, type: 'CONSUME' } })).toBe(0);
  });

  it('stops working once the member shows a new code, or after it expires', async () => {
    const member = await memberWithBalance(5_000);
    const old = await issue(member.token);
    const fresh = await issue(member.token);
    const stale = await scan(tokens.clerkA, old.body.code, storeA);
    expect(stale.status).toBe(400);
    expect(messageOf(stale.body)).toContain('已失效');
    expect((await statusOf(member.token, old.body.id)).status).toBe(404);

    await prisma.memberPayCode.update({
      where: { id: fresh.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await statusOf(member.token, fresh.body.id)).body.status).toBe('EXPIRED');
    const late = await scan(tokens.clerkA, fresh.body.code, storeA);
    expect(late.status).toBe(400);
    expect(messageOf(late.body)).toContain('已过期');

    // 扫码后超过 5 分钟才提交，也要重新扫。
    const third = await issue(member.token);
    await scan(tokens.clerkA, third.body.code, storeA);
    await prisma.memberPayCode.update({
      where: { id: third.body.id },
      data: { claimExpiresAt: new Date(Date.now() - 1_000) },
    });
    const slow = await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 100, payCode: third.body.code });
    expect(slow.status).toBe(400);
    expect(messageOf(slow.body)).toContain('超过 5 分钟');
    expect((await statusOf(member.token, third.body.id)).body.status).toBe('EXPIRED');
  });

  it('tells the cashier when the scanned thing is not a member code', async () => {
    for (const code of ['https://example.com/pay', '134567890123456789', '800000000000000001', '']) {
      const response = await scan(tokens.clerkA, code, storeA);
      expect(response.status).toBe(400);
      expect(messageOf(response.body)).toMatch(/会员码/);
    }
  });

  it('does not accept a code from another company', async () => {
    const member = await memberWithBalance(1_000);
    const { body } = await issue(member.token);
    const otherOrg = await prisma.org.create({ data: { name: `别家${Date.now()}`, status: 'ACTIVE' } });
    const otherStore = await prisma.store.create({ data: { orgId: otherOrg.id, name: '别家店', status: 'ACTIVE' } });
    const outsiderPhone = randomPhone();
    await prisma.staff.create({
      data: {
        orgId: otherOrg.id,
        phone: outsiderPhone,
        name: '别家店员',
        status: 'ACTIVE',
        storeRoles: { create: { storeId: otherStore.id, role: StaffRole.STAFF } },
      },
    });
    wechat.bind('outsider', outsiderPhone);
    const login = await http()
      .post('/auth/staff/wx-phone')
      .send({ code: 'outsider', phoneCode: 'phone', orgId: otherOrg.id });
    expect(login.status).toBe(201);
    const response = await scan(login.body.accessToken as string, body.code, otherStore.id);
    expect(response.status).toBe(400);
    expect((await prisma.memberPayCode.findUniqueOrThrow({ where: { id: body.id } })).status).toBe('ISSUED');
  });

  it('gives no code before the card is opened, and keeps members and staff on their own side', async () => {
    const phone = randomPhone();
    wechat.bind(`lonely-${phone}`, phone);
    const lonely = await http()
      .post('/auth/member/wx-phone')
      .send({ code: `lonely-${phone}`, phoneCode: 'phone', orgId });
    const noCard = await issue(lonely.body.accessToken as string);
    expect(noCard.status).toBe(400);
    expect(messageOf(noCard.body)).toContain('还没开卡');

    const member = await memberWithBalance(1_000);
    const { body } = await issue(member.token);
    expect((await issue(tokens.clerkA)).status).toBe(403);
    expect((await scan(member.token, body.code, storeA)).status).toBe(403);
    const other = await memberWithBalance(0);
    expect((await statusOf(other.token, body.id)).status).toBe(404);
  });

  it('keeps a used code as a permanent record', async () => {
    const member = await memberWithBalance(1_000);
    const { body } = await issue(member.token);
    await scan(tokens.clerkA, body.code, storeA);
    await consume(tokens.clerkA, member.id, { storeId: storeA, amountCent: 100, payCode: body.code });
    await expect(
      prisma.memberPayCode.update({ where: { id: body.id }, data: { status: 'SCANNED', ledgerEntryId: null, usedAt: null } }),
    ).rejects.toThrow();
    await expect(prisma.memberPayCode.delete({ where: { id: body.id } })).rejects.toThrow();
  });
});
