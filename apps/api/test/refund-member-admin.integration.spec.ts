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
import { scanPayCode } from './support/pay-code';

/**
 * 上线前补的两件：退余额（店长、超级管理员把没用完的储值退给顾客）和会员资料维护（换手机号、改称呼、停用）。
 * 流水和操作记录只能追加，不清理数据；每次运行用一个新的组织。
 */
describe('refund balance and member maintenance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let closedStore = '';
  const tokens = { super: '', managerA: '', clerkA: '' };

  function http() {
    return request(app.getHttpServer());
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function memberLogin(code: string, phone: string) {
    wechat.bind(code, phone);
    return http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
  }

  async function openCard(storeId: string, phone = randomPhone(), name?: string) {
    const response = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ phone, storeId, ...(name ? { name } : {}) });
    expect(response.status).toBe(201);
    return response.body as { id: string; phone: string };
  }

  async function recharge(memberId: string, amountCent: number, storeId = storeA) {
    const response = await http()
      .post(`/wallets/${memberId}/recharge`)
      .set('Authorization', `Bearer ${tokens.clerkA}`)
      .send({ storeId, amountCent, requestId: randomUUID() });
    expect(response.status).toBe(201);
    return response.body.entry as { id: string };
  }

  function refund(
    token: string,
    memberId: string,
    body: { storeId: string; amountCent: unknown; remark?: unknown; requestId?: string },
  ) {
    return http()
      .post(`/wallets/${memberId}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestId: randomUUID(), ...body });
  }

  async function balanceOf(memberId: string): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
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

    const org = await prisma.org.create({ data: { name: `退余额测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    closedStore = (await prisma.store.create({ data: { orgId, name: '已关店', status: 'DISABLED' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '旗舰店长', StaffRole.STORE_MANAGER, storeA],
      ['clerkA', '旗舰店员', StaffRole.STAFF, storeA],
    ];
    for (const [key, name, role, storeId] of people) {
      const phone = randomPhone();
      await prisma.staff.create({
        data: { orgId, phone, name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      wechat.bind(key, phone);
      tokens[key] = await staffLogin(key);
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('refund', () => {
    it('lets the store manager refund part of the balance, recorded as a REFUND with the reason', async () => {
      const card = await openCard(storeA);
      await recharge(card.id, 50_000);
      const response = await refund(tokens.managerA, card.id, {
        storeId: storeA,
        amountCent: 20_000,
        remark: '顾客要退一部分，现金退回',
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        balanceCent: 30_000,
        replayed: false,
        entry: {
          type: 'REFUND',
          amountCent: 20_000,
          changeCent: -20_000,
          balanceBefore: 50_000,
          balanceAfter: 30_000,
          storeId: storeA,
          remark: '顾客要退一部分，现金退回',
          operatorName: '旗舰店长',
        },
      });
      expect(await balanceOf(card.id)).toBe(30_000);
      const audit = await prisma.auditLog.findFirst({
        where: { orgId, action: 'WALLET_REFUND', targetId: response.body.entry.id },
      });
      expect(audit?.storeId).toBe(storeA);
      expect(audit?.payloadJson).toMatchObject({ amountCent: 20_000, remark: '顾客要退一部分，现金退回' });

      const labels = await http().get('/audit-logs/actions').set('Authorization', `Bearer ${tokens.super}`);
      expect(labels.status).toBe(200);
      expect(JSON.stringify(labels.body)).toContain('退余额');
    });

    it('refunds the whole balance once even when the same request is sent twice', async () => {
      const card = await openCard(storeA);
      await recharge(card.id, 12_345);
      const requestId = randomUUID();
      const body = { storeId: storeA, amountCent: 12_345, remark: '全部退，微信转账', requestId };
      const [first, second] = await Promise.all([
        refund(tokens.super, card.id, body),
        refund(tokens.super, card.id, body),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.entry.id).toBe(second.body.entry.id);
      expect(await balanceOf(card.id)).toBe(0);
      expect(await prisma.ledgerEntry.count({ where: { memberId: card.id, type: 'REFUND' } })).toBe(1);
    });

    it('refuses clerks, other stores, closed stores, over-balance amounts and a missing reason', async () => {
      const card = await openCard(storeA);
      await recharge(card.id, 10_000);

      const clerk = await refund(tokens.clerkA, card.id, { storeId: storeA, amountCent: 100, remark: '试试' });
      expect(clerk.status).toBe(403);
      expect(messageOf(clerk.body)).toContain('店长');

      const otherStore = await refund(tokens.managerA, card.id, { storeId: storeB, amountCent: 100, remark: '试试' });
      expect(otherStore.status).toBe(403);

      const closed = await refund(tokens.super, card.id, { storeId: closedStore, amountCent: 100, remark: '试试' });
      expect(closed.status).toBe(400);
      expect(messageOf(closed.body)).toContain('门店已停用');

      const tooMuch = await refund(tokens.managerA, card.id, { storeId: storeA, amountCent: 10_001, remark: '多退' });
      expect(tooMuch.status).toBe(400);
      expect(messageOf(tooMuch.body)).toContain('超过了会员余额');

      for (const remark of [undefined, '', '   ']) {
        const noReason = await refund(tokens.managerA, card.id, { storeId: storeA, amountCent: 100, remark });
        expect(noReason.status).toBe(400);
      }
      for (const amountCent of [0, -1, 1.5, '100']) {
        const bad = await refund(tokens.managerA, card.id, { storeId: storeA, amountCent, remark: '金额不对' });
        expect(bad.status).toBe(400);
      }
      expect(await balanceOf(card.id)).toBe(10_000);
    });

    it('can refund a disabled member, and a wrong refund can be reversed back into the balance', async () => {
      const card = await openCard(storeA);
      await recharge(card.id, 8_000);
      const disabled = await http()
        .post(`/members/${card.id}/disable`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ reason: '顾客要求退卡' });
      expect(disabled.status).toBe(201);

      const refunded = await refund(tokens.managerA, card.id, { storeId: storeA, amountCent: 8_000, remark: '退卡，现金' });
      expect(refunded.status).toBe(201);
      expect(await balanceOf(card.id)).toBe(0);

      const reversed = await http()
        .post(`/ledger/${refunded.body.entry.id}/reversal`)
        .set('Authorization', `Bearer ${tokens.managerA}`)
        .send({ remark: '退错了人', requestId: randomUUID() });
      expect(reversed.status).toBe(201);
      expect(reversed.body.entry).toMatchObject({
        type: 'REVERSAL',
        changeCent: 8_000,
        reversalOfId: refunded.body.entry.id,
        reversalOfType: 'REFUND',
      });
      expect(await balanceOf(card.id)).toBe(8_000);

      const again = await http()
        .post(`/ledger/${refunded.body.entry.id}/reversal`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ remark: '再冲一次', requestId: randomUUID() });
      expect(again.status).toBe(409);
    });

    it('keeps the database rule: a REFUND must reduce the balance by its amount', async () => {
      const card = await openCard(storeA);
      await recharge(card.id, 1_000);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { memberId: card.id } });
      await expect(
        prisma.ledgerEntry.create({
          data: {
            orgId,
            memberId: card.id,
            walletId: wallet.id,
            storeId: storeA,
            type: 'REFUND',
            amountCent: 500,
            balanceBefore: 1_000,
            balanceAfter: 1_500,
          },
        }),
      ).rejects.toThrow(/ledger_entries_balance_matches_type/);
    });

    it('shows refunds as their own column in the daily reconciliation and keeps the balance check green', async () => {
      const daily = await http().get('/reconciliation/daily').set('Authorization', `Bearer ${tokens.super}`);
      expect(daily.status).toBe(200);
      const a = daily.body.stores.find((store: { storeId: string }) => store.storeId === storeA);
      // 本组织今天在旗舰店：退了 20000 + 12345 + 8000，冲回了 8000 那笔。
      expect(a).toMatchObject({
        refundCount: 3,
        refundCent: 40_345,
        reversedRefundCent: 8_000,
        netRefundCent: 32_345,
      });
      expect(a.netChangeCent).toBe(a.netRechargeCent - a.netConsumeCent - a.netRefundCent);
      expect(daily.body.balance.closingCent).toBe(daily.body.balance.openingCent + daily.body.total.netChangeCent);

      const check = await http().get('/reconciliation/check').set('Authorization', `Bearer ${tokens.super}`);
      expect(check.status).toBe(200);
      expect(check.body).toMatchObject({ ok: true, mismatchCount: 0 });
      expect(check.body.ledgerNetCent).toBe(check.body.totalBalanceCent);
    });

    it('shows the member a refund and its undo in plain words, without staff details', async () => {
      const phone = randomPhone();
      const login = await memberLogin('refund-member', phone);
      expect(login.status).toBe(201);
      const card = await openCard(storeA, phone);
      await recharge(card.id, 3_000);
      const refunded = await refund(tokens.managerA, card.id, { storeId: storeA, amountCent: 1_000, remark: '店内备注' });
      expect(refunded.status).toBe(201);
      const ledger = await http().get('/ledger').set('Authorization', `Bearer ${login.body.accessToken}`);
      expect(ledger.status).toBe(200);
      const item = ledger.body.items.find((entry: { id: string }) => entry.id === refunded.body.entry.id);
      expect(item).toMatchObject({ type: 'REFUND', changeCent: -1_000, balanceAfter: 2_000, reversalOfType: null });
      expect(item).not.toHaveProperty('remark');
      expect(item).not.toHaveProperty('operatorName');
    });
  });

  describe('member maintenance', () => {
    it('changes the phone: the old phone login stops working, the new phone logs in to the same card', async () => {
      const oldPhone = randomPhone();
      const login = await memberLogin('old-phone', oldPhone);
      expect(login.status).toBe(201);
      const oldToken = login.body.accessToken as string;
      const card = await openCard(storeA, oldPhone, '王女士');
      await recharge(card.id, 6_600);
      expect((await http().get('/members/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);

      const newPhone = randomPhone();
      const noReason = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: newPhone });
      expect(noReason.status).toBe(400);

      const changed = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: ` +86 ${newPhone} `, name: ' 王姐 ', reason: '顾客手机丢了，本人到店核对' });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({ id: card.id, phone: newPhone, name: '王姐', balanceCent: 6_600, wechatBound: false });

      expect((await http().get('/members/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
      expect((await http().post('/auth/member/session/renew').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
      // 旧号再登录是一位新的、没开卡的会员，看不到原来的余额。
      const oldAgain = await memberLogin('old-phone-again', oldPhone);
      expect(oldAgain.status).toBe(201);
      expect(oldAgain.body.member.id).not.toBe(card.id);
      expect(oldAgain.body.needsCard).toBe(true);

      const fresh = await memberLogin('new-phone', newPhone);
      expect(fresh.status).toBe(201);
      expect(fresh.body.member.id).toBe(card.id);
      const wallet = await http().get('/members/me/wallet').set('Authorization', `Bearer ${fresh.body.accessToken}`);
      expect(wallet.body).toMatchObject({ hasCard: true, balanceCent: 6_600 });

      const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'MEMBER_UPDATE', targetId: card.id } });
      expect(audit?.payloadJson).toMatchObject({
        previousPhone: oldPhone,
        phone: newPhone,
        previousName: '王女士',
        name: '王姐',
        reason: '顾客手机丢了，本人到店核对',
      });
      const listed = await http()
        .get('/audit-logs')
        .query({ action: 'MEMBER_UPDATE' })
        .set('Authorization', `Bearer ${tokens.super}`);
      const view = listed.body.items.find((item: { targetId: string }) => item.targetId === card.id);
      expect(view.actionLabel).toBe('修改会员资料');
      expect(view.payload.phone).toMatch(/^\d{3}\*{4}\d{4}$/);
      expect(view.payload.previousPhone).toMatch(/^\d{3}\*{4}\d{4}$/);
    });

    it('takes over a phone that only has an empty mini-program login, but not one with a card', async () => {
      const card = await openCard(storeA, randomPhone(), '换号顾客');
      const emptyPhone = randomPhone();
      const empty = await memberLogin('empty-holder', emptyPhone);
      expect(empty.status).toBe(201);
      const emptyId = empty.body.member.id as string;

      const takeOver = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: emptyPhone, reason: '顾客新号先登录过小程序' });
      expect(takeOver.status).toBe(200);
      expect(await prisma.member.findUnique({ where: { id: emptyId } })).toBeNull();
      expect((await http().get('/members/me').set('Authorization', `Bearer ${empty.body.accessToken}`)).status).toBe(401);
      const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'MEMBER_UPDATE', targetId: card.id } });
      expect(audit?.payloadJson).toMatchObject({ releasedMemberId: emptyId });

      const other = await openCard(storeA);
      const taken = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: other.phone, reason: '填错' });
      expect(taken.status).toBe(409);
      expect(messageOf(taken.body)).toContain('另一位会员');
    });

    it('refuses a phone change while a benefit contract is still waiting to be signed', async () => {
      const card = await openCard(storeA);
      const template = await prisma.contractTemplate.create({
        data: { orgId, esignTemplateId: `tpl-${randomUUID()}`, name: '储值会员权益单', status: 'ACTIVE' },
      });
      await prisma.signFlow.create({
        data: { orgId, memberId: card.id, templateId: template.id, storeId: storeA, status: 'PENDING', title: '储值会员权益单', esignFlowId: `flow-${randomUUID()}` },
      });
      const response = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: randomPhone(), reason: '换号' });
      expect(response.status).toBe(409);
      expect(messageOf(response.body)).toContain('没签完的权益单');
      // 只改称呼不受影响。
      const rename = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ name: '赵先生' });
      expect(rename.status).toBe(200);
      expect(rename.body.name).toBe('赵先生');
    });

    it('disables and re-enables a member: logins end, bookings stop, and only super admins can do it', async () => {
      const phone = randomPhone();
      const login = await memberLogin('to-disable', phone);
      const card = await openCard(storeA, phone);
      await recharge(card.id, 2_000);

      for (const token of [tokens.managerA, tokens.clerkA]) {
        const denied = await http()
          .post(`/members/${card.id}/disable`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: '试试' });
        expect(denied.status).toBe(403);
        const edit = await http().patch(`/members/${card.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'x' });
        expect(edit.status).toBe(403);
      }
      const noReason = await http().post(`/members/${card.id}/disable`).set('Authorization', `Bearer ${tokens.super}`).send({});
      expect(noReason.status).toBe(400);

      const disabled = await http()
        .post(`/members/${card.id}/disable`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ reason: '手机丢了，先停用' });
      expect(disabled.status).toBe(201);
      expect(disabled.body.status).toBe('DISABLED');
      expect((await http().get('/members/me').set('Authorization', `Bearer ${login.body.accessToken}`)).status).toBe(401);
      expect((await memberLogin('to-disable-again', phone)).status).toBe(403);
      const rechargeBlocked = await http()
        .post(`/wallets/${card.id}/recharge`)
        .set('Authorization', `Bearer ${tokens.clerkA}`)
        .send({ storeId: storeA, amountCent: 100, requestId: randomUUID() });
      expect(rechargeBlocked.status).toBe(400);
      expect((await http().post(`/members/${card.id}/disable`).set('Authorization', `Bearer ${tokens.super}`).send({ reason: '再停' })).status).toBe(409);

      const enabled = await http()
        .post(`/members/${card.id}/enable`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ reason: '找回手机了' });
      expect(enabled.status).toBe(201);
      expect(enabled.body.status).toBe('ACTIVE');
      // 停用前的旧登录不会复活，要重新登录。
      expect((await http().get('/members/me').set('Authorization', `Bearer ${login.body.accessToken}`)).status).toBe(401);
      const back = await memberLogin('to-disable-back', phone);
      expect(back.status).toBe(201);
      expect(back.body.member.id).toBe(card.id);
      const scanned = await scanPayCode(app, orgId, tokens.clerkA, card.id, storeA);
      const consume = await http()
        .post(`/wallets/${card.id}/consume`)
        .set('Authorization', `Bearer ${tokens.clerkA}`)
        .send({ storeId: storeA, amountCent: 500, payCode: scanned, requestId: randomUUID() });
      expect(consume.status).toBe(201);

      const actions = (await prisma.auditLog.findMany({ where: { orgId, targetId: card.id }, orderBy: { createdAt: 'asc' } })).map(
        (log) => log.action,
      );
      expect(actions).toEqual(expect.arrayContaining(['MEMBER_DISABLE', 'MEMBER_ENABLE']));
    });

    it('rejects an empty edit, a bad phone and an unknown member', async () => {
      const card = await openCard(storeA, randomPhone(), '同名');
      const same = await http().patch(`/members/${card.id}`).set('Authorization', `Bearer ${tokens.super}`).send({ name: '同名' });
      expect(same.status).toBe(400);
      const bad = await http()
        .patch(`/members/${card.id}`)
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ phone: '12345', reason: '试试' });
      expect(bad.status).toBe(400);
      const missing = await http()
        .patch('/members/not-a-member')
        .set('Authorization', `Bearer ${tokens.super}`)
        .send({ name: '谁' });
      expect(missing.status).toBe(404);
    });
  });
});
