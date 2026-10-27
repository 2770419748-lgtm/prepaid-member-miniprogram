import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';

/**
 * M2 验收：开卡、充值、扣款、冲正、流水查询、并发扣款。
 * 流水在数据库层只能追加，所以这里不清理测试数据；每次运行用一个新的组织，互不影响。
 */
describe('M2 wallet and ledger', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let closedStore = '';
  const tokens = { super: '', managerA: '', managerB: '', clerkA: '', clerkB: '', member: '', otherMember: '' };
  const staffIds = { clerkA: '' };
  let loggedInMemberId = '';

  const phones = {
    super: randomPhone(),
    managerA: randomPhone(),
    managerB: randomPhone(),
    clerkA: randomPhone(),
    clerkB: randomPhone(),
    member: randomPhone(),
    otherMember: randomPhone(),
  };

  function http() {
    return request(app.getHttpServer());
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function memberLogin(code: string): Promise<{ token: string; id: string }> {
    const response = await http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return { token: response.body.accessToken as string, id: response.body.member.id as string };
  }

  async function openCard(token: string, storeId: string, phone = randomPhone(), name?: string) {
    const response = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone, storeId, ...(name ? { name } : {}) });
    expect(response.status).toBe(201);
    return response.body as { id: string; phone: string; balanceCent: number; hasCard: boolean };
  }

  function move(
    kind: 'recharge' | 'consume',
    token: string,
    memberId: string,
    body: { storeId: string; amountCent: unknown; remark?: string; requestId?: string },
  ) {
    return http().post(`/wallets/${memberId}/${kind}`).set('Authorization', `Bearer ${token}`).send(body);
  }

  function reverse(token: string, entryId: string, body: { remark: string; requestId?: string }) {
    return http().post(`/ledger/${entryId}/reversal`).set('Authorization', `Bearer ${token}`).send(body);
  }

  async function walletOf(memberId: string) {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
    return wallet;
  }

  /** 账本自洽：按时间串起来，每笔的前余额等于上一笔的后余额，最后一笔等于钱包余额。 */
  async function expectChainConsistent(memberId: string): Promise<void> {
    const wallet = await walletOf(memberId);
    const entries = await prisma.ledgerEntry.findMany({
      where: { memberId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // 并发下 createdAt 可能相同，所以按"前余额 → 后余额"把链条接起来，而不是只看时间顺序。
    let cursor = 0;
    const remaining = [...entries];
    while (remaining.length > 0) {
      const index = remaining.findIndex((entry) => entry.balanceBefore === cursor);
      expect(index).toBeGreaterThanOrEqual(0);
      cursor = remaining[index].balanceAfter;
      remaining.splice(index, 1);
    }
    expect(cursor).toBe(wallet.balanceCent);
    expect(wallet.version).toBe(entries.length);
    const sum = entries.reduce((total, entry) => total + (entry.balanceAfter - entry.balanceBefore), 0);
    expect(sum).toBe(wallet.balanceCent);
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

    const org = await prisma.org.create({ data: { name: `账本测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    closedStore = (await prisma.store.create({ data: { orgId, name: '已关店', status: 'DISABLED' } })).id;

    const people: [keyof typeof phones, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '旗舰店长', StaffRole.STORE_MANAGER, storeA],
      ['managerB', '社区店长', StaffRole.STORE_MANAGER, storeB],
      ['clerkA', '旗舰店员', StaffRole.STAFF, storeA],
      ['clerkB', '社区店员', StaffRole.STAFF, storeB],
    ];
    for (const [key, name, role, storeId] of people) {
      const staff = await prisma.staff.create({
        data: { orgId, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      if (key === 'clerkA') {
        staffIds.clerkA = staff.id;
      }
      wechat.bind(key, phones[key]);
    }
    tokens.super = await staffLogin('super');
    tokens.managerA = await staffLogin('managerA');
    tokens.managerB = await staffLogin('managerB');
    tokens.clerkA = await staffLogin('clerkA');
    tokens.clerkB = await staffLogin('clerkB');
    wechat.bind('member', phones.member);
    wechat.bind('otherMember', phones.otherMember);
    const member = await memberLogin('member');
    tokens.member = member.token;
    loggedInMemberId = member.id;
    tokens.otherMember = (await memberLogin('otherMember')).token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('open card', () => {
    it('creates the member and an empty wallet together, and refuses a second card for the same phone', async () => {
      const phone = randomPhone();
      const card = await openCard(tokens.clerkA, storeA, ` +86 ${phone} `, '王女士');
      expect(card).toMatchObject({ phone, hasCard: true, balanceCent: 0, openStoreId: storeA, openStoreName: '旗舰店' });
      const wallet = await walletOf(card.id);
      expect(wallet).toMatchObject({ balanceCent: 0, version: 0 });
      const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'MEMBER_CARD_OPEN', targetId: card.id } });
      expect(audit?.actorStaffId).toBe(staffIds.clerkA);

      const again = await http()
        .post('/members/open')
        .set('Authorization', `Bearer ${tokens.clerkB}`)
        .send({ phone, storeId: storeB });
      expect(again.status).toBe(409);
      expect(messageOf(again.body)).toContain('已开卡');
    });

    it('adds a wallet to a member who logged in to the mini program before visiting a store', async () => {
      const before = await http().get('/members/me/wallet').set('Authorization', `Bearer ${tokens.member}`);
      expect(before.status).toBe(200);
      expect(before.body).toEqual({ hasCard: false, balanceCent: 0, openedAt: null, updatedAt: null });

      const card = await openCard(tokens.clerkA, storeA, phones.member, '李先生');
      expect(card.id).toBe(loggedInMemberId);

      const me = await http().get('/members/me').set('Authorization', `Bearer ${tokens.member}`);
      expect(me.body).toMatchObject({ needsCard: false, name: '李先生', openStoreId: storeA });
      const after = await http().get('/members/me/wallet').set('Authorization', `Bearer ${tokens.member}`);
      expect(after.body).toMatchObject({ hasCard: true, balanceCent: 0 });
    });

    it('lets two clerks open the same phone at once with only one card created', async () => {
      const phone = randomPhone();
      const results = await Promise.all([
        http().post('/members/open').set('Authorization', `Bearer ${tokens.clerkA}`).send({ phone, storeId: storeA }),
        http().post('/members/open').set('Authorization', `Bearer ${tokens.clerkB}`).send({ phone, storeId: storeB }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await prisma.member.count({ where: { orgId, phone } })).toBe(1);
      expect(await prisma.wallet.count({ where: { member: { orgId, phone } } })).toBe(1);
    });

    it('blocks opening a card at another store, at a closed store, or with a bad phone, and blocks members', async () => {
      const cross = await http()
        .post('/members/open')
        .set('Authorization', `Bearer ${tokens.clerkB}`)
        .send({ phone: randomPhone(), storeId: storeA });
      expect(cross.status).toBe(403);
      const closed = await http()
        .post('/members/open')
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: randomPhone(), storeId: closedStore });
      expect(closed.status).toBe(400);
      const badPhone = await http()
        .post('/members/open')
        .set('Authorization', `Bearer ${tokens.clerkA}`)
        .send({ phone: '12345', storeId: storeA });
      expect(badPhone.status).toBe(400);
      const byMember = await http()
        .post('/members/open')
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ phone: randomPhone(), storeId: storeA });
      expect(byMember.status).toBe(403);
    });

    it('finds any member by full phone from any store, but fuzzy search stays within the store', async () => {
      const phone = randomPhone();
      const card = await openCard(tokens.clerkA, storeA, phone, '跨店顾客');
      const exact = await http()
        .get('/members')
        .query({ phone })
        .set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(exact.status).toBe(200);
      expect(exact.body.items.map((item: { id: string }) => item.id)).toEqual([card.id]);

      const fuzzyB = await http()
        .get('/members')
        .query({ keyword: '跨店顾客' })
        .set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(fuzzyB.body.total).toBe(0);
      const fuzzyA = await http()
        .get('/members')
        .query({ keyword: '跨店顾客' })
        .set('Authorization', `Bearer ${tokens.clerkA}`);
      expect(fuzzyA.body.items.map((item: { id: string }) => item.id)).toEqual([card.id]);

      const detail = await http().get(`/members/${card.id}`).set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ id: card.id, balanceCent: 0, hasCard: true });

      const memberTriesStaffRoute = await http().get('/members').set('Authorization', `Bearer ${tokens.member}`);
      expect(memberTriesStaffRoute.status).toBe(403);
      const staffTriesMemberRoute = await http().get('/members/me').set('Authorization', `Bearer ${tokens.clerkA}`);
      expect(staffTriesMemberRoute.status).toBe(403);
    });
  });

  describe('recharge and consume', () => {
    it('runs the acceptance case: open, recharge 100.00, spend 30.00, two entries, balance 70.00', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      const recharge = await move('recharge', tokens.clerkA, card.id, {
        storeId: storeA,
        amountCent: 10000,
        remark: '现金',
      });
      expect(recharge.status).toBe(201);
      expect(recharge.body).toMatchObject({
        balanceCent: 10000,
        replayed: false,
        entry: { type: 'RECHARGE', amountCent: 10000, changeCent: 10000, balanceBefore: 0, balanceAfter: 10000 },
      });

      const consume = await move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 3000 });
      expect(consume.status).toBe(201);
      expect(consume.body).toMatchObject({
        balanceCent: 7000,
        entry: { type: 'CONSUME', amountCent: 3000, changeCent: -3000, balanceBefore: 10000, balanceAfter: 7000 },
      });

      const ledger = await http()
        .get('/ledger')
        .query({ memberId: card.id })
        .set('Authorization', `Bearer ${tokens.clerkA}`);
      expect(ledger.status).toBe(200);
      expect(ledger.body.total).toBe(2);
      expect(ledger.body.items.map((item: { type: string }) => item.type)).toEqual(['CONSUME', 'RECHARGE']);
      expect((await walletOf(card.id)).balanceCent).toBe(7000);

      const audits = await prisma.auditLog.findMany({
        where: { orgId, targetType: 'LedgerEntry', targetId: { in: [recharge.body.entry.id, consume.body.entry.id] } },
      });
      expect(audits.map((audit) => audit.action).sort()).toEqual(['WALLET_CONSUME', 'WALLET_RECHARGE']);
      await expectChainConsistent(card.id);
    });

    it('refuses to spend more than the balance and leaves no entry behind', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 500 });
      const over = await move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 501 });
      expect(over.status).toBe(400);
      expect(messageOf(over.body)).toContain('余额不足');
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id } })).toBe(1);
      expect((await walletOf(card.id)).balanceCent).toBe(500);
    });

    it('rejects zero, negative, fractional, text and oversized amounts, and balance overrides', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      for (const amountCent of [0, -100, 10.5, '100', 100_000_001]) {
        const response = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent });
        expect(response.status).toBe(400);
      }
      const sneaky = await http()
        .post(`/wallets/${card.id}/recharge`)
        .set('Authorization', `Bearer ${tokens.clerkA}`)
        .send({ storeId: storeA, amountCent: 100, balanceCent: 99999999 });
      expect(sneaky.status).toBe(400);
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id } })).toBe(0);
    });

    it('keeps the balance company-wide: a card opened at one store can be used at another', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 8000 });
      const spendAtB = await move('consume', tokens.clerkB, card.id, { storeId: storeB, amountCent: 2500 });
      expect(spendAtB.status).toBe(201);
      expect(spendAtB.body.balanceCent).toBe(5500);
      expect(spendAtB.body.entry).toMatchObject({ storeId: storeB, storeName: '社区店' });
    });

    it('blocks recording at a store outside the operator scope, at a closed store, and for members', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      const cross = await move('recharge', tokens.clerkB, card.id, { storeId: storeA, amountCent: 100 });
      expect(cross.status).toBe(403);
      const crossManager = await move('recharge', tokens.managerB, card.id, { storeId: storeA, amountCent: 100 });
      expect(crossManager.status).toBe(403);
      const closed = await move('recharge', tokens.super, card.id, { storeId: closedStore, amountCent: 100 });
      expect(closed.status).toBe(400);
      const byMember = await move('recharge', tokens.member, card.id, { storeId: storeA, amountCent: 100 });
      expect(byMember.status).toBe(403);
      const unknownMember = await move('recharge', tokens.clerkA, 'no-such-member', { storeId: storeA, amountCent: 100 });
      expect(unknownMember.status).toBe(404);
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id } })).toBe(0);
    });

    it('refuses to record for a member who has no card yet', async () => {
      const lonelyPhone = randomPhone();
      wechat.bind('lonely', lonelyPhone);
      const lonely = await memberLogin('lonely');
      const response = await move('recharge', tokens.clerkA, lonely.id, { storeId: storeA, amountCent: 100 });
      expect(response.status).toBe(400);
      expect(messageOf(response.body)).toContain('还没开卡');
    });

    it('records only once when the same request number is sent twice, even at the same moment', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      const requestId = randomUUID();
      const first = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 2000, requestId });
      const second = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 2000, requestId });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.replayed).toBe(true);
      expect(second.body.entry.id).toBe(first.body.entry.id);
      expect((await walletOf(card.id)).balanceCent).toBe(2000);

      const reused = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 3000, requestId });
      expect(reused.status).toBe(409);

      const burstId = randomUUID();
      const burst = await Promise.all(
        Array.from({ length: 4 }, () =>
          move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 300, requestId: burstId }),
        ),
      );
      expect(burst.every((response) => response.status === 201)).toBe(true);
      expect(new Set(burst.map((response) => response.body.entry.id as string)).size).toBe(1);
      expect((await walletOf(card.id)).balanceCent).toBe(1700);
      await expectChainConsistent(card.id);
    });
  });

  describe('concurrency', () => {
    it('lets at most one of several simultaneous over-drafting deductions through and never goes negative', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 5000 });
      const results = await Promise.all([
        move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 3000 }),
        move('consume', tokens.clerkB, card.id, { storeId: storeB, amountCent: 3000 }),
        move('consume', tokens.managerA, card.id, { storeId: storeA, amountCent: 3000 }),
        move('consume', tokens.managerB, card.id, { storeId: storeB, amountCent: 3000 }),
        move('consume', tokens.super, card.id, { storeId: storeA, amountCent: 3000 }),
      ]);
      const statuses = results.map((result) => result.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status !== 201).every((status) => status === 400 || status === 409)).toBe(true);
      const wallet = await walletOf(card.id);
      expect(wallet.balanceCent).toBe(2000);
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id, type: 'CONSUME' } })).toBe(1);
      await expectChainConsistent(card.id);
    });

    it('keeps every cent when many small deductions and top-ups land at the same time', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 4000 });
      const consumes = Array.from({ length: 8 }, (_, index) =>
        move('consume', index % 2 === 0 ? tokens.clerkA : tokens.clerkB, card.id, {
          storeId: index % 2 === 0 ? storeA : storeB,
          amountCent: 500,
        }),
      );
      const recharges = Array.from({ length: 3 }, () =>
        move('recharge', tokens.managerA, card.id, { storeId: storeA, amountCent: 100 }),
      );
      const results = await Promise.all([...consumes, ...recharges]);
      // 同时改同一只钱包会自动重读重试；极端拥挤时才可能有一笔返回 409 让前端重试。
      expect(results.every((result) => result.status === 201 || result.status === 409)).toBe(true);
      const succeeded = results.filter((result) => result.status === 201);
      const expected =
        4000 +
        succeeded.reduce((total, result) => total + (result.body.entry.changeCent as number), 0);
      expect(succeeded.length).toBeGreaterThanOrEqual(results.length - 2);
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id } })).toBe(1 + succeeded.length);
      expect((await walletOf(card.id)).balanceCent).toBe(expected);
      await expectChainConsistent(card.id);
    });
  });

  describe('reversal', () => {
    it('lets the store manager undo a mistaken recharge once, and only once', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      const wrong = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 100000 });
      const entryId = wrong.body.entry.id as string;

      const byClerk = await reverse(tokens.clerkA, entryId, { remark: '多打了一个零' });
      expect(byClerk.status).toBe(403);
      expect(messageOf(byClerk.body)).toContain('原门店店长');
      const byOtherManager = await reverse(tokens.managerB, entryId, { remark: '多打了一个零' });
      expect(byOtherManager.status).toBe(403);
      expect(messageOf(byOtherManager.body)).toContain('原门店');
      const byMember = await reverse(tokens.member, entryId, { remark: '想退钱' });
      expect(byMember.status).toBe(403);
      const noReason = await reverse(tokens.managerA, entryId, { remark: '' });
      expect(noReason.status).toBe(400);

      const undo = await reverse(tokens.managerA, entryId, { remark: '多打了一个零' });
      expect(undo.status).toBe(201);
      expect(undo.body).toMatchObject({
        balanceCent: 0,
        entry: {
          type: 'REVERSAL',
          amountCent: 100000,
          changeCent: -100000,
          storeId: storeA,
          reversalOfId: entryId,
          remark: '多打了一个零',
        },
      });
      const twice = await reverse(tokens.super, entryId, { remark: '再冲一次' });
      expect(twice.status).toBe(409);
      const reverseTheReversal = await reverse(tokens.super, undo.body.entry.id as string, { remark: '冲正的冲正' });
      expect(reverseTheReversal.status).toBe(400);

      const original = await http().get(`/ledger/${entryId}`).set('Authorization', `Bearer ${tokens.managerA}`);
      expect(original.body.reversedById).toBe(undo.body.entry.id);

      const right = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 10000 });
      expect(right.body.balanceCent).toBe(10000);
      await expectChainConsistent(card.id);
    });

    it('gives back a mistaken deduction, and the super admin can reverse at any store', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 5000 });
      const wrong = await move('consume', tokens.clerkB, card.id, { storeId: storeB, amountCent: 1200 });
      const undo = await reverse(tokens.super, wrong.body.entry.id as string, { remark: '扣错人了' });
      expect(undo.status).toBe(201);
      expect(undo.body).toMatchObject({ balanceCent: 5000, entry: { changeCent: 1200, storeId: storeB } });
      await expectChainConsistent(card.id);
    });

    it('refuses to reverse a recharge that has already been spent', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      const recharge = await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 1000 });
      await move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 800 });
      const undo = await reverse(tokens.managerA, recharge.body.entry.id as string, { remark: '撤销充值' });
      expect(undo.status).toBe(400);
      expect(messageOf(undo.body)).toContain('余额不足');
      expect((await walletOf(card.id)).balanceCent).toBe(200);
    });

    it('allows only one of two simultaneous reversals of the same entry', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 3000 });
      const wrong = await move('consume', tokens.clerkA, card.id, { storeId: storeA, amountCent: 1000 });
      const entryId = wrong.body.entry.id as string;
      const results = await Promise.all([
        reverse(tokens.managerA, entryId, { remark: '同时冲正一' }),
        reverse(tokens.super, entryId, { remark: '同时冲正二' }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await prisma.ledgerEntry.count({ where: { reversalOfId: entryId } })).toBe(1);
      expect((await walletOf(card.id)).balanceCent).toBe(3000);
      await expectChainConsistent(card.id);
    });
  });

  describe('ledger queries', () => {
    let memberCardId = '';
    let entryAtA = '';
    let entryAtB = '';

    beforeAll(async () => {
      const card = await openCard(tokens.clerkA, storeA, phones.otherMember);
      memberCardId = card.id;
      entryAtA = (await move('recharge', tokens.clerkA, card.id, { storeId: storeA, amountCent: 6000, remark: '店内备注' }))
        .body.entry.id as string;
      entryAtB = (await move('consume', tokens.clerkB, card.id, { storeId: storeB, amountCent: 1000 })).body.entry
        .id as string;
    });

    it('shows a member only their own entries, without staff names or in-store remarks', async () => {
      const mine = await http().get('/ledger').set('Authorization', `Bearer ${tokens.otherMember}`);
      expect(mine.status).toBe(200);
      expect(mine.body.total).toBe(2);
      for (const item of mine.body.items as Record<string, unknown>[]) {
        expect(item).not.toHaveProperty('operatorName');
        expect(item).not.toHaveProperty('operatorStaffId');
        expect(item).not.toHaveProperty('remark');
        expect(item).not.toHaveProperty('memberPhone');
      }
      expect(mine.body.items[0]).toMatchObject({ type: 'CONSUME', changeCent: -1000, balanceAfter: 5000, storeName: '社区店' });

      const peek = await http()
        .get('/ledger')
        .query({ memberId: loggedInMemberId })
        .set('Authorization', `Bearer ${tokens.otherMember}`);
      expect(peek.status).toBe(403);
      const other = await http().get(`/ledger/${entryAtA}`).set('Authorization', `Bearer ${tokens.member}`);
      expect(other.status).toBe(404);
      const own = await http().get(`/ledger/${entryAtA}`).set('Authorization', `Bearer ${tokens.otherMember}`);
      expect(own.status).toBe(200);

      const wallet = await http().get('/members/me/wallet').set('Authorization', `Bearer ${tokens.otherMember}`);
      expect(wallet.body).toMatchObject({ hasCard: true, balanceCent: 5000 });
    });

    it('shows clerks only what happened in their store, and the super admin everything', async () => {
      const atB = await http()
        .get('/ledger')
        .query({ memberId: memberCardId })
        .set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(atB.body.items.map((item: { id: string }) => item.id)).toEqual([entryAtB]);
      expect(atB.body.items[0]).toMatchObject({ operatorName: '社区店员', memberPhone: phones.otherMember });

      const crossDetail = await http().get(`/ledger/${entryAtA}`).set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(crossDetail.status).toBe(403);
      const crossFilter = await http()
        .get('/ledger')
        .query({ storeId: storeA })
        .set('Authorization', `Bearer ${tokens.clerkB}`);
      expect(crossFilter.status).toBe(403);

      const all = await http()
        .get('/ledger')
        .query({ memberId: memberCardId })
        .set('Authorization', `Bearer ${tokens.super}`);
      expect(all.body.total).toBe(2);
      expect(all.body.items.find((item: { id: string }) => item.id === entryAtA)).toMatchObject({ remark: '店内备注' });
    });

    it('filters by type and time and pages through results', async () => {
      const recharges = await http()
        .get('/ledger')
        .query({ memberId: memberCardId, type: 'RECHARGE' })
        .set('Authorization', `Bearer ${tokens.super}`);
      expect(recharges.body.items.map((item: { id: string }) => item.id)).toEqual([entryAtA]);

      const future = await http()
        .get('/ledger')
        .query({ memberId: memberCardId, from: new Date(Date.now() + 60_000).toISOString() })
        .set('Authorization', `Bearer ${tokens.super}`);
      expect(future.body.total).toBe(0);

      const backwards = await http()
        .get('/ledger')
        .query({ from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' })
        .set('Authorization', `Bearer ${tokens.super}`);
      expect(backwards.status).toBe(400);

      const paged = await http()
        .get('/ledger')
        .query({ memberId: memberCardId, page: 2, pageSize: 1 })
        .set('Authorization', `Bearer ${tokens.super}`);
      expect(paged.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(paged.body.items.map((item: { id: string }) => item.id)).toEqual([entryAtA]);
    });
  });

  describe('append-only ledger', () => {
    it('has no route to change or delete an entry', async () => {
      const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { orgId } });
      const del = await http().delete(`/ledger/${entry.id}`).set('Authorization', `Bearer ${tokens.super}`);
      expect(del.status).toBe(404);
      const patch = await http()
        .patch(`/ledger/${entry.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ amountCent: 1 });
      expect(patch.status).toBe(404);
    });

    it('refuses deletes, edits and truncation in the database itself', async () => {
      const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { orgId } });
      await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
      await expect(
        prisma.ledgerEntry.update({ where: { id: entry.id }, data: { remark: '偷偷改' } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe('TRUNCATE ledger_entries')).rejects.toThrow(/append-only/);
      const still = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(still.remark).toBe(entry.remark);
    });

    it('refuses a negative balance or an entry whose numbers do not add up, even from raw SQL', async () => {
      const card = await openCard(tokens.clerkA, storeA);
      await expect(
        prisma.wallet.update({ where: { memberId: card.id }, data: { balanceCent: -1 } }),
      ).rejects.toThrow(/wallets_balance_cent_non_negative/);
      const wallet = await walletOf(card.id);
      await expect(
        prisma.ledgerEntry.create({
          data: {
            orgId,
            memberId: card.id,
            walletId: wallet.id,
            storeId: storeA,
            type: 'RECHARGE',
            amountCent: 100,
            balanceBefore: 0,
            balanceAfter: 999,
          },
        }),
      ).rejects.toThrow(/ledger_entries_balance_matches_type/);
    });
  });
});
