import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerEntry, StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, randomPhone } from './support/fake-wechat';
import { scanPayCode } from './support/pay-code';

interface AuditItem {
  id: string;
  action: string;
  actionLabel: string;
  actorStaffId: string | null;
  actorName: string | null;
  storeId: string | null;
  storeName: string | null;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface Figures {
  rechargeCount: number;
  rechargeCent: number;
  consumeCount: number;
  consumeCent: number;
  reversalCount: number;
  reversedRechargeCent: number;
  reversedConsumeCent: number;
  netRechargeCent: number;
  netConsumeCent: number;
  netChangeCent: number;
}

/** 按流水逐行算一遍，用来对照接口用 SQL 汇总出来的数。 */
function figuresOf(entries: LedgerEntry[]): Figures {
  const figures: Figures = {
    rechargeCount: 0,
    rechargeCent: 0,
    consumeCount: 0,
    consumeCent: 0,
    reversalCount: 0,
    reversedRechargeCent: 0,
    reversedConsumeCent: 0,
    netRechargeCent: 0,
    netConsumeCent: 0,
    netChangeCent: 0,
  };
  for (const entry of entries) {
    if (entry.type === 'RECHARGE') {
      figures.rechargeCount += 1;
      figures.rechargeCent += entry.amountCent;
    } else if (entry.type === 'CONSUME') {
      figures.consumeCount += 1;
      figures.consumeCent += entry.amountCent;
    } else {
      figures.reversalCount += 1;
      if (entry.balanceAfter > entry.balanceBefore) {
        figures.reversedConsumeCent += entry.amountCent;
      } else {
        figures.reversedRechargeCent += entry.amountCent;
      }
    }
  }
  figures.netRechargeCent = figures.rechargeCent - figures.reversedRechargeCent;
  figures.netConsumeCent = figures.consumeCent - figures.reversedConsumeCent;
  figures.netChangeCent = figures.netRechargeCent - figures.netConsumeCent;
  return figures;
}

/**
 * P2 验收：操作记录查询与权限、只追加；当日对账与流水一致、上海时区跨日；余额核对。
 * 操作记录和流水在数据库层只能追加，所以这里不清理测试数据；每次运行用一个新的组织，互不影响。
 */
describe('P2 audit log and reconciliation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  const tokens = { super: '', managerA: '', managerB: '', clerkA: '', clerkB: '', member: '' };
  const ids = { super: '', managerA: '', managerB: '', clerkA: '', clerkB: '' };
  const phones = {
    super: randomPhone(),
    managerA: randomPhone(),
    managerB: randomPhone(),
    clerkA: randomPhone(),
    clerkB: randomPhone(),
    member: randomPhone(),
  };

  /** 主流程留下的对象，后面的用例按它们查。 */
  const flow = {
    memberId: '',
    memberPhone: '',
    rechargeId: '',
    consumeId: '',
    consumeReversalId: '',
    secondRechargeId: '',
    rechargeReversalId: '',
  };

  function http() {
    return request(app.getHttpServer());
  }

  function get(token: string, path: string) {
    return http().get(path).set('Authorization', `Bearer ${token}`);
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function openCard(token: string, storeId: string, phone = randomPhone()): Promise<string> {
    const response = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone, storeId, name: '周女士' });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function move(
    kind: 'recharge' | 'consume',
    token: string,
    memberId: string,
    storeId: string,
    amountCent: number,
    payCode?: string,
  ): Promise<string> {
    // 消费要先扫会员码。没给码时替这位店员扫一张；并发用例先依次扫好再同时提交。
    const code =
      kind === 'consume' ? (payCode ?? (await scanPayCode(app, orgId, token, memberId, storeId))) : undefined;
    const response = await http()
      .post(`/wallets/${memberId}/${kind}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId, amountCent, requestId: randomUUID(), ...(code ? { payCode: code } : {}) });
    expect(response.status).toBe(201);
    return response.body.entry.id as string;
  }

  async function reverse(token: string, entryId: string): Promise<string> {
    const response = await http()
      .post(`/ledger/${entryId}/reversal`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remark: '记错了', requestId: randomUUID() });
    expect(response.status).toBe(201);
    return response.body.entry.id as string;
  }

  async function auditOf(token: string, query: string): Promise<AuditItem[]> {
    const response = await get(token, `/audit-logs?pageSize=100&${query}`);
    expect(response.status).toBe(200);
    return response.body.items as AuditItem[];
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

    const org = await prisma.org.create({ data: { name: `对账测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;

    const people: [keyof typeof ids, string, StaffRole, string][] = [
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
      ids[key] = staff.id;
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
    wechat.bind('member', phones.member);
    const memberResponse = await http()
      .post('/auth/member/wx-phone')
      .send({ code: 'member', phoneCode: 'phone', orgId });
    expect(memberResponse.status).toBe(201);
    tokens.member = memberResponse.body.accessToken as string;

    // 主流程：旗舰店开卡、充值；社区店消费后由社区店长冲正；旗舰店再充一笔由旗舰店长冲回。
    flow.memberPhone = randomPhone();
    flow.memberId = await openCard(tokens.clerkA, storeA, flow.memberPhone);
    flow.rechargeId = await move('recharge', tokens.clerkA, flow.memberId, storeA, 10_000);
    flow.consumeId = await move('consume', tokens.clerkB, flow.memberId, storeB, 3_000);
    flow.consumeReversalId = await reverse(tokens.managerB, flow.consumeId);
    flow.secondRechargeId = await move('recharge', tokens.clerkA, flow.memberId, storeA, 5_000);
    flow.rechargeReversalId = await reverse(tokens.managerA, flow.secondRechargeId);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('audit log', () => {
    it('records open card, recharge, consume and reversal with operator, store and amount', async () => {
      const items = await auditOf(tokens.super, `targetId=${flow.memberId}`);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        action: 'MEMBER_CARD_OPEN',
        actionLabel: '开卡',
        actorStaffId: ids.clerkA,
        actorName: '旗舰店员',
        storeId: storeA,
        storeName: '旗舰店',
        targetType: 'Member',
      });
      // 手机号打码。
      expect(items[0].payload?.phone).toBe(`${flow.memberPhone.slice(0, 3)}****${flow.memberPhone.slice(-4)}`);

      const [recharge] = await auditOf(tokens.super, `targetId=${flow.rechargeId}`);
      expect(recharge).toMatchObject({
        action: 'WALLET_RECHARGE',
        actionLabel: '充值',
        actorStaffId: ids.clerkA,
        storeId: storeA,
        targetType: 'LedgerEntry',
        payload: { memberId: flow.memberId, storeId: storeA, amountCent: 10_000, balanceBefore: 0, balanceAfter: 10_000 },
      });
      const [consume] = await auditOf(tokens.super, `targetId=${flow.consumeId}`);
      expect(consume).toMatchObject({
        action: 'WALLET_CONSUME',
        actorStaffId: ids.clerkB,
        storeId: storeB,
        payload: { amountCent: 3_000 },
      });
      const [reversal] = await auditOf(tokens.super, `targetId=${flow.consumeReversalId}`);
      expect(reversal).toMatchObject({
        action: 'WALLET_REVERSAL',
        actorStaffId: ids.managerB,
        storeId: storeB,
        payload: { reversalOfId: flow.consumeId, amountCent: 3_000 },
      });

      const detail = await get(tokens.super, `/audit-logs/${recharge.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toEqual(recharge);
    });

    it('filters by action, store, operator and time', async () => {
      const recharges = await auditOf(tokens.super, 'action=WALLET_RECHARGE');
      expect(recharges.map((item) => item.targetId).sort()).toEqual([flow.rechargeId, flow.secondRechargeId].sort());
      const atB = await auditOf(tokens.super, `storeId=${storeB}`);
      expect(atB.length).toBeGreaterThan(0);
      expect(atB.every((item) => item.storeId === storeB)).toBe(true);
      const byManagerA = await auditOf(tokens.super, `actorStaffId=${ids.managerA}`);
      expect(byManagerA.map((item) => item.targetId)).toEqual([flow.rechargeReversalId]);
      const future = await auditOf(tokens.super, 'from=2099-01-01T00:00:00%2B08:00');
      expect(future).toHaveLength(0);
      const backwards = await get(tokens.super, '/audit-logs?from=2026-10-28T00:00:00Z&to=2026-10-27T00:00:00Z');
      expect(backwards.status).toBe(400);
    });

    it('lets a clerk see only their own actions', async () => {
      const items = await auditOf(tokens.clerkA, '');
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.every((item) => item.actorStaffId === ids.clerkA)).toBe(true);
      // 同店店长的冲正不是自己做的，看不到。
      expect(items.some((item) => item.targetId === flow.rechargeReversalId)).toBe(false);
      const [others] = await auditOf(tokens.super, `targetId=${flow.consumeId}`);
      expect((await get(tokens.clerkA, `/audit-logs/${others.id}`)).status).toBe(404);
    });

    it('lets a store manager see records at their store and their own actions, not other stores', async () => {
      const items = await auditOf(tokens.managerA, '');
      const targets = items.map((item) => item.targetId);
      expect(targets).toEqual(expect.arrayContaining([flow.memberId, flow.rechargeId, flow.rechargeReversalId]));
      expect(targets).not.toContain(flow.consumeId);
      expect(targets).not.toContain(flow.consumeReversalId);
      expect(items.every((item) => item.storeId === storeA || item.actorStaffId === ids.managerA)).toBe(true);
      const [atB] = await auditOf(tokens.super, `targetId=${flow.consumeReversalId}`);
      expect((await get(tokens.managerA, `/audit-logs/${atB.id}`)).status).toBe(404);
      expect((await get(tokens.managerB, `/audit-logs/${atB.id}`)).status).toBe(200);
      // 筛别的门店也只会得到空，不会越权。
      expect(await auditOf(tokens.managerA, `storeId=${storeB}`)).toHaveLength(0);
    });

    it('lets a super admin see everything, including records without a store', async () => {
      const items = await auditOf(tokens.super, 'action=MEMBER_IDENTITY_CREATE');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ actorStaffId: null, storeId: null, targetType: 'Member' });
      expect(items[0].payload?.phone).toBe(`${phones.member.slice(0, 3)}****${phones.member.slice(-4)}`);
      expect(await auditOf(tokens.managerA, 'action=MEMBER_IDENTITY_CREATE')).toHaveLength(0);
    });

    it('lists action names for the filter', async () => {
      const response = await get(tokens.clerkA, '/audit-logs/actions');
      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          { action: 'MEMBER_CARD_OPEN', label: '开卡' },
          { action: 'WALLET_RECHARGE', label: '充值' },
          { action: 'WALLET_CONSUME', label: '消费扣款' },
          { action: 'SIGN_FLOW_CREATE', label: '发起签署' },
        ]),
      );
    });

    it('has no way to change or delete a record', async () => {
      const [record] = await auditOf(tokens.super, `targetId=${flow.rechargeId}`);
      expect((await http().delete(`/audit-logs/${record.id}`).set('Authorization', `Bearer ${tokens.super}`)).status).toBe(404);
      expect((await http().patch(`/audit-logs/${record.id}`).set('Authorization', `Bearer ${tokens.super}`).send({})).status).toBe(404);
      expect((await http().post('/audit-logs').set('Authorization', `Bearer ${tokens.super}`).send({})).status).toBe(404);
      await expect(prisma.auditLog.update({ where: { id: record.id }, data: { action: 'X' } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditLog.delete({ where: { id: record.id } })).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    });
  });

  describe('daily reconciliation', () => {
    async function todayEntries(from: string, to: string, storeId?: string) {
      return prisma.ledgerEntry.findMany({
        where: { orgId, createdAt: { gte: new Date(from), lt: new Date(to) }, ...(storeId ? { storeId } : {}) },
      });
    }

    it('matches the ledger store by store for today, with reversals split by direction', async () => {
      const response = await get(tokens.super, '/reconciliation/daily');
      expect(response.status).toBe(200);
      const body = response.body as {
        date: string;
        timezone: string;
        from: string;
        to: string;
        stores: (Figures & { storeId: string; storeName: string })[];
        total: Figures;
        balance: { openingCent: number; netChangeCent: number; closingCent: number } | null;
      };
      expect(body.timezone).toBe('Asia/Shanghai');
      expect(body.stores.map((store) => store.storeName)).toEqual(['旗舰店', '社区店']);
      for (const store of body.stores) {
        const expected = figuresOf(await todayEntries(body.from, body.to, store.storeId));
        expect(store).toMatchObject(expected);
      }
      expect(body.total).toEqual(figuresOf(await todayEntries(body.from, body.to)));

      const a = body.stores.find((store) => store.storeId === storeA)!;
      const b = body.stores.find((store) => store.storeId === storeB)!;
      expect(a).toMatchObject({ rechargeCount: 2, rechargeCent: 15_000, reversedRechargeCent: 5_000, netRechargeCent: 10_000 });
      expect(b).toMatchObject({ consumeCount: 1, consumeCent: 3_000, reversedConsumeCent: 3_000, netConsumeCent: 0 });

      expect(body.balance).not.toBeNull();
      expect(body.balance!.closingCent).toBe(body.balance!.openingCent + body.total.netChangeCent);
    });

    it('limits store managers and clerks to their own stores', async () => {
      const manager = await get(tokens.managerA, '/reconciliation/daily');
      expect(manager.status).toBe(200);
      expect(manager.body.stores.map((store: { storeId: string }) => store.storeId)).toEqual([storeA]);
      expect(manager.body.balance).toBeNull();
      const clerk = await get(tokens.clerkB, '/reconciliation/daily');
      expect(clerk.body.stores.map((store: { storeId: string }) => store.storeId)).toEqual([storeB]);
      expect((await get(tokens.managerA, `/reconciliation/daily?storeId=${storeB}`)).status).toBe(403);
      const filtered = await get(tokens.super, `/reconciliation/daily?storeId=${storeB}`);
      expect(filtered.body.stores).toHaveLength(1);
      expect(filtered.body.balance).toBeNull();
    });

    it('counts 23:30 and 00:30 Shanghai time on different days', async () => {
      const memberId = await openCard(tokens.clerkA, storeA);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
      // 补录两笔历史流水（测试数据），钱包同步到对应余额。
      await prisma.ledgerEntry.create({
        data: {
          orgId,
          memberId,
          walletId: wallet.id,
          storeId: storeA,
          operatorStaffId: ids.clerkA,
          type: 'RECHARGE',
          amountCent: 1_000,
          balanceBefore: 0,
          balanceAfter: 1_000,
          createdAt: new Date('2026-03-10T23:30:00+08:00'),
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          orgId,
          memberId,
          walletId: wallet.id,
          storeId: storeB,
          operatorStaffId: ids.clerkB,
          type: 'CONSUME',
          amountCent: 300,
          balanceBefore: 1_000,
          balanceAfter: 700,
          createdAt: new Date('2026-03-11T00:30:00+08:00'),
        },
      });
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balanceCent: 700, version: 2 } });

      const first = await get(tokens.super, '/reconciliation/daily?date=2026-03-10');
      expect(first.status).toBe(200);
      expect(first.body.from).toBe('2026-03-09T16:00:00.000Z');
      expect(first.body.total).toMatchObject({ rechargeCount: 1, rechargeCent: 1_000, consumeCount: 0 });
      expect(first.body.balance).toEqual({ openingCent: 0, netChangeCent: 1_000, closingCent: 1_000 });

      const second = await get(tokens.super, '/reconciliation/daily?date=2026-03-11');
      expect(second.body.total).toMatchObject({ rechargeCount: 0, consumeCount: 1, consumeCent: 300 });
      expect(second.body.stores.find((store: { storeId: string }) => store.storeId === storeB)).toMatchObject({
        consumeCent: 300,
      });
      expect(second.body.balance).toEqual({ openingCent: 1_000, netChangeCent: -300, closingCent: 700 });
    });

    it('rejects dates that do not exist', async () => {
      expect((await get(tokens.super, '/reconciliation/daily?date=2026-02-30')).status).toBe(400);
      expect((await get(tokens.super, '/reconciliation/daily?date=yesterday')).status).toBe(400);
    });
  });

  describe('overview', () => {
    it('shows the company total only to the super admin', async () => {
      const wallets = await prisma.wallet.findMany({ where: { member: { orgId } } });
      const all = await get(tokens.super, '/reconciliation/overview');
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({
        scope: 'ORG',
        cardCount: wallets.length,
        totalBalanceCent: wallets.reduce((sum, wallet) => sum + wallet.balanceCent, 0),
      });
      const manager = await get(tokens.managerB, '/reconciliation/overview');
      expect(manager.body).toMatchObject({ scope: 'STORES', cardCount: 0, totalBalanceCent: null });
      expect(manager.body.today).toMatchObject({ consumeCent: 3_000, reversedConsumeCent: 3_000 });
    });
  });

  describe('balance check', () => {
    it('finds every wallet consistent, including after concurrent bookings', async () => {
      const memberId = await openCard(tokens.clerkA, storeA);
      await move('recharge', tokens.clerkA, memberId, storeA, 50_000);
      const codes: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        codes.push(await scanPayCode(app, orgId, tokens.clerkB, memberId, storeB));
      }
      await Promise.all([
        ...codes.map((code) => move('consume', tokens.clerkB, memberId, storeB, 1_000, code)),
        ...Array.from({ length: 4 }, () => move('recharge', tokens.clerkA, memberId, storeA, 700)),
      ]);
      const response = await get(tokens.super, '/reconciliation/check');
      expect(response.status).toBe(200);
      const wallets = await prisma.wallet.findMany({ where: { member: { orgId } } });
      expect(response.body).toMatchObject({
        ok: true,
        walletCount: wallets.length,
        entryCount: await prisma.ledgerEntry.count({ where: { orgId } }),
        totalBalanceCent: wallets.reduce((sum, wallet) => sum + wallet.balanceCent, 0),
        mismatchCount: 0,
        mismatches: [],
      });
      expect(response.body.ledgerNetCent).toBe(response.body.totalBalanceCent);
    });

    it('reports a wallet whose balance no longer matches its ledger', async () => {
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId: flow.memberId } });
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balanceCent: wallet.balanceCent + 1 } });
      try {
        const response = await get(tokens.super, '/reconciliation/check');
        expect(response.body.ok).toBe(false);
        expect(response.body.mismatchCount).toBe(1);
        expect(response.body.mismatches[0]).toMatchObject({
          memberId: flow.memberId,
          memberPhone: `${flow.memberPhone.slice(0, 3)}****${flow.memberPhone.slice(-4)}`,
          balanceCent: wallet.balanceCent + 1,
          ledgerNetCent: wallet.balanceCent,
          lastBalanceAfter: wallet.balanceCent,
          version: wallet.version,
          entryCount: wallet.version,
          chainBreaks: 0,
        });
      } finally {
        await prisma.wallet.update({ where: { id: wallet.id }, data: { balanceCent: wallet.balanceCent } });
      }
      expect((await get(tokens.super, '/reconciliation/check')).body.ok).toBe(true);
    });

    it('is only for the super admin', async () => {
      expect((await get(tokens.managerA, '/reconciliation/check')).status).toBe(403);
      expect((await get(tokens.clerkA, '/reconciliation/check')).status).toBe(403);
    });
  });

  it('refuses members on every audit and reconciliation endpoint', async () => {
    for (const path of [
      '/audit-logs',
      '/audit-logs/actions',
      '/audit-logs/anything',
      '/reconciliation/daily',
      '/reconciliation/overview',
      '/reconciliation/check',
    ]) {
      expect((await get(tokens.member, path)).status).toBe(403);
    }
  });
});
