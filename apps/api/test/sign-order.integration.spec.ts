import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { EsignClient } from '../src/esign/client/esign.client';
import { MemberAppCodeService } from '../src/member-app/member-app-code.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { signFlowRequestId, WalletService } from '../src/wallet/wallet.service';
import { FakeEsign } from './support/fake-esign';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';

/**
 * 开单：店员输手机号开卡 → 填会员权益金额发起权益单 → 会员签完才充值到账 → 弹会员小程序码。
 * 充值由 WalletService 记一笔普通充值，回调、刷新、会员端刷新怎么重复都只记一笔。
 * e签宝用本机假沙箱。流水和操作记录只追加，不清理，每次用新组织。
 */
describe('sign order: contract first, then the benefit amount is recharged', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  const fake = new FakeEsign('order-app-id', 'order-app-secret');
  const storageDir = mkdtempSync(join(tmpdir(), 'sign-order-storage-'));
  const savedEnv = { ...process.env };
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let templateId = '';
  let plainTemplateId = '';
  const tokens = { super: '', managerA: '', clerkA: '', clerkB: '' };
  const phones = { super: randomPhone(), managerA: randomPhone(), clerkA: randomPhone(), clerkB: randomPhone() };
  const staffIds = { clerkA: '' };

  function http() {
    return request(app.getHttpServer());
  }

  function as(token: string) {
    return {
      get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body?: object) =>
        http().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    };
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function memberLogin(phone: string): Promise<string> {
    const code = `member-${phone}`;
    wechat.bind(code, phone);
    const response = await http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  /** 店员办一张新卡，返回会员号。 */
  async function newCard(token = tokens.clerkA, storeId = storeA): Promise<{ id: string; phone: string }> {
    const phone = randomPhone();
    const opened = await as(token).post('/members/open', { phone, storeId });
    expect(opened.status).toBe(201);
    return { id: opened.body.id as string, phone };
  }

  async function order(memberId: string, amountCent: number, options: { token?: string; storeId?: string } = {}) {
    const response = await as(options.token ?? tokens.clerkA).post('/sign-flows', {
      memberId,
      templateId,
      storeId: options.storeId ?? storeA,
      rechargeAmountCent: amountCent,
      requestId: randomUUID(),
    });
    expect(response.status).toBe(201);
    return response.body as { id: string; status: string; rechargeAmountCent: number; rechargeEntryId: string | null };
  }

  async function esignIdOf(flowId: string): Promise<string> {
    return (await prisma.signFlow.findUniqueOrThrow({ where: { id: flowId } })).esignFlowId!;
  }

  async function balanceOf(memberId: string): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
  }

  function webhook(signFlowId: string) {
    const raw = JSON.stringify({ action: 'SIGN_FLOW_COMPLETE', signFlowId, signFlowStatus: '2' });
    return http().post('/webhooks/esign').set(fake.callbackHeaders(raw)).send(raw);
  }

  beforeAll(async () => {
    await fake.start();
    fake.templates.set('tpl-order', {
      name: '储值会员权益单',
      componentKeys: ['contractNo', 'memberPhone', 'benefitTitle', 'benefitAmount', 'benefitAmountWords', 'signDate'],
      keywords: ['会员签字', '商家盖章'],
    });
    fake.templates.set('tpl-no-amount', {
      name: '没有金额填写项的旧模板',
      componentKeys: ['contractNo', 'memberPhone'],
      keywords: ['会员签字', '商家盖章'],
    });
    process.env.WECHAT_MEMBER_APPID = 'test-member-app';
    process.env.WECHAT_MEMBER_SECRET = 'test-member-secret';
    process.env.WECHAT_STAFF_APPID = 'test-staff-app';
    process.env.WECHAT_STAFF_SECRET = 'test-staff-secret';
    process.env.WECHAT_PHONE_MOCK = 'false';
    process.env.ESIGN_PRODUCTION_ENABLED = 'false';
    process.env.ESIGN_API_HOST = fake.baseUrl;
    process.env.ESIGN_APP_ID = fake.appId;
    process.env.ESIGN_APP_SECRET = fake.secret;
    delete process.env.ESIGN_NOTIFY_URL;
    delete process.env.ESIGN_REDIRECT_URL;
    process.env.STORAGE_LOCAL_DIR = storageDir;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatPhoneClient)
      .useValue(wechat)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'], rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    app.get(EsignClient).pollIntervalMs = 1;

    const org = await prisma.org.create({ data: { name: `开单测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '滨江店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '西湖店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '陈店长', StaffRole.STORE_MANAGER, storeA],
      ['clerkA', '李晓', StaffRole.STAFF, storeA],
      ['clerkB', '西湖店员', StaffRole.STAFF, storeB],
    ];
    for (const [key, name, role, storeId] of people) {
      const staff = await prisma.staff.create({
        data: { orgId, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      if (key === 'clerkA') {
        staffIds.clerkA = staff.id;
      }
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
    const plan = await as(tokens.super).post('/benefit-plans', {
      title: '储值会员权益',
      items: [{ title: '全场护理 9 折' }, { title: '生日月赠护理一次' }],
    });
    expect(plan.status).toBe(201);
    const template = await as(tokens.super).post('/contract-templates', {
      esignTemplateId: 'tpl-order',
      name: '储值会员权益单',
      benefitPlanId: plan.body.id,
    });
    expect(template.status).toBe(201);
    templateId = template.body.id as string;
    const plain = await as(tokens.super).post('/contract-templates', {
      esignTemplateId: 'tpl-no-amount',
      name: '旧模板',
    });
    expect(plain.status).toBe(201);
    plainTemplateId = plain.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
    await fake.stop();
    rmSync(storageDir, { recursive: true, force: true });
    process.env = savedEnv;
  });

  it('writes the benefit amount into the contract and does not recharge before signing', async () => {
    const member = await newCard();
    const flow = await order(member.id, 100000);
    expect(flow).toMatchObject({ status: 'PENDING', rechargeAmountCent: 100000, rechargeEntryId: null });

    const fill = fake.callsTo('/v3/files/create-by-doc-template').at(-1)!.body as {
      components: { componentKey: string; componentValue: string }[];
    };
    const values = Object.fromEntries(fill.components.map((c) => [c.componentKey, c.componentValue]));
    expect(values).toMatchObject({ benefitAmount: '1,000.00', benefitAmountWords: '壹仟元整' });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, action: 'SIGN_FLOW_CREATE', targetId: flow.id } });
    expect(audit.payloadJson).toMatchObject({ memberId: member.id, rechargeAmountCent: 100000 });

    const refreshed = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`);
    expect(refreshed.body).toMatchObject({ status: 'PENDING', rechargeEntryId: null });
    expect(await balanceOf(member.id)).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { memberId: member.id } })).toBe(0);
  });

  it('recharges exactly once after the member signs, however many times the status is synced', async () => {
    const member = await newCard();
    const flow = await order(member.id, 123456);
    const esignId = await esignIdOf(flow.id);
    fake.complete(esignId);

    const results = await Promise.all([
      as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`),
      as(tokens.managerA).post(`/sign-flows/${flow.id}/refresh`),
      webhook(esignId),
      webhook(esignId),
      as(tokens.super).post(`/sign-flows/${flow.id}/refresh`),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 200, 200, 201]);

    const memberToken = await memberLogin(member.phone);
    expect((await as(memberToken).post(`/members/me/sign-flows/${flow.id}/refresh`)).status).toBe(201);
    expect((await webhook(esignId)).status).toBe(200);

    const entries = await prisma.ledgerEntry.findMany({ where: { memberId: member.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'RECHARGE',
      amountCent: 123456,
      balanceBefore: 0,
      balanceAfter: 123456,
      storeId: storeA,
      operatorStaffId: staffIds.clerkA,
      remark: '权益单签署后充值',
      requestId: signFlowRequestId(flow.id),
    });
    expect(await balanceOf(member.id)).toBe(123456);

    const stored = await prisma.signFlow.findUniqueOrThrow({ where: { id: flow.id } });
    expect(stored).toMatchObject({ status: 'SIGNED', rechargeEntryId: entries[0].id });
    const view = await as(tokens.clerkA).get(`/sign-flows/${flow.id}`);
    expect(view.body).toMatchObject({ status: 'SIGNED', rechargeAmountCent: 123456, rechargeEntryId: entries[0].id });

    const audit = await prisma.auditLog.findMany({ where: { orgId, action: 'WALLET_RECHARGE', targetId: entries[0].id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorStaffId: staffIds.clerkA, storeId: storeA });
    expect(audit[0].payloadJson).toMatchObject({ signFlowId: flow.id, amountCent: 123456, balanceAfter: 123456 });

    // 会员端：权益单上看得到金额和已到账，明细里是一笔充值。
    const mine = await as(memberToken).get(`/members/me/sign-flows/${flow.id}`);
    expect(mine.body).toMatchObject({ status: 'SIGNED', rechargeAmountCent: 123456, recharged: true });
    expect(JSON.stringify(mine.body)).not.toContain(staffIds.clerkA);
    const ledger = await as(memberToken).get('/ledger');
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0]).toMatchObject({ type: 'RECHARGE', amountCent: 123456 });
  });

  it('picks up the recharge already written when syncing stopped halfway', async () => {
    const member = await newCard();
    const flow = await order(member.id, 50000);
    fake.complete(await esignIdOf(flow.id));
    // 模拟上次同步记完流水、还没回填权益单就断了。
    const written = await app.get(WalletService).creditSignedContract({
      orgId,
      memberId: member.id,
      storeId: storeA,
      operatorStaffId: staffIds.clerkA,
      signFlowId: flow.id,
      amountCent: 50000,
    });
    const refreshed = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`);
    expect(refreshed.body).toMatchObject({ status: 'SIGNED', rechargeEntryId: written.entry.id });
    expect(await prisma.ledgerEntry.count({ where: { memberId: member.id } })).toBe(1);
    expect(await balanceOf(member.id)).toBe(50000);
  });

  it('does not recharge when the contract is canceled, rejected or expires', async () => {
    const canceled = await newCard();
    const flow = await order(canceled.id, 30000);
    expect((await as(tokens.managerA).post(`/sign-flows/${flow.id}/cancel`, { reason: '金额填错' })).status).toBe(201);
    expect((await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`)).body).toMatchObject({
      status: 'CANCELED',
      rechargeEntryId: null,
    });

    for (const status of [7, 5]) {
      const member = await newCard();
      const other = await order(member.id, 30000);
      fake.complete(await esignIdOf(other.id), status);
      const refreshed = await as(tokens.clerkA).post(`/sign-flows/${other.id}/refresh`);
      expect(refreshed.body.status).toBe(status === 7 ? 'REJECTED' : 'EXPIRED');
      expect(await balanceOf(member.id)).toBe(0);
    }
    expect(await balanceOf(canceled.id)).toBe(0);
  });

  it('still recharges a signed contract after its store was closed', async () => {
    const member = await newCard(tokens.clerkB, storeB);
    const flow = await order(member.id, 20000, { token: tokens.clerkB, storeId: storeB });
    await prisma.store.update({ where: { id: storeB }, data: { status: 'DISABLED' } });
    try {
      fake.complete(await esignIdOf(flow.id));
      const refreshed = await as(tokens.super).post(`/sign-flows/${flow.id}/refresh`);
      expect(refreshed.body.rechargeEntryId).not.toBeNull();
      expect(await balanceOf(member.id)).toBe(20000);
    } finally {
      await prisma.store.update({ where: { id: storeB }, data: { status: 'ACTIVE' } });
    }
  });

  it('the store manager can reverse the recharge like any other', async () => {
    const member = await newCard();
    const flow = await order(member.id, 10000);
    fake.complete(await esignIdOf(flow.id));
    const signed = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`);
    const reversal = await as(tokens.managerA).post(`/ledger/${signed.body.rechargeEntryId}/reversal`, {
      remark: '顾客当场退了',
      requestId: randomUUID(),
    });
    expect(reversal.status).toBe(201);
    expect(await balanceOf(member.id)).toBe(0);
  });

  it('needs an open card and a template that shows the amount', async () => {
    const phone = randomPhone();
    const memberToken = await memberLogin(phone);
    const me = await as(memberToken).get('/members/me');
    expect(me.status).toBe(200);
    const noCard = await as(tokens.clerkA).post('/sign-flows', {
      memberId: me.body.id as string,
      templateId,
      storeId: storeA,
      rechargeAmountCent: 10000,
    });
    expect(noCard.status).toBe(400);
    expect(messageOf(noCard.body)).toContain('还没开卡');

    const member = await newCard();
    const oldTemplate = await as(tokens.clerkA).post('/sign-flows', {
      memberId: member.id,
      templateId: plainTemplateId,
      storeId: storeA,
      rechargeAmountCent: 10000,
    });
    expect(oldTemplate.status).toBe(400);
    expect(messageOf(oldTemplate.body)).toContain('会员权益金额');
    expect(await prisma.signFlow.count({ where: { memberId: member.id } })).toBe(0);

    // 不带金额的旧用法照旧。
    const plain = await as(tokens.clerkA).post('/sign-flows', { memberId: member.id, templateId: plainTemplateId, storeId: storeA });
    expect(plain.status).toBe(201);
    expect(plain.body.rechargeAmountCent).toBeNull();

    for (const bad of [0, -1, 1.5, 100_000_001]) {
      const response = await as(tokens.clerkA).post('/sign-flows', {
        memberId: member.id,
        templateId,
        storeId: storeA,
        rechargeAmountCent: bad,
      });
      expect(response.status).toBe(400);
    }
  });

  it('a repeated request id with a different amount is refused', async () => {
    const member = await newCard();
    const requestId = randomUUID();
    const body = { memberId: member.id, templateId, storeId: storeA, rechargeAmountCent: 10000, requestId };
    const first = await as(tokens.clerkA).post('/sign-flows', body);
    expect(first.status).toBe(201);
    const same = await as(tokens.clerkA).post('/sign-flows', body);
    expect(same.body.id).toBe(first.body.id);
    const changed = await as(tokens.clerkA).post('/sign-flows', { ...body, rechargeAmountCent: 20000 });
    expect(changed.status).toBe(409);
  });

  it('the database keeps the amount fixed once the contract is out', async () => {
    const member = await newCard();
    const flow = await order(member.id, 10000);
    await expect(
      prisma.signFlow.update({ where: { id: flow.id }, data: { rechargeAmountCent: 99999 } }),
    ).rejects.toThrow(/recharge_amount_cent is fixed/);
    const other = await prisma.ledgerEntry.findFirstOrThrow({ where: { orgId } });
    await expect(
      prisma.signFlow.update({ where: { id: flow.id }, data: { rechargeEntryId: other.id } }),
    ).rejects.toThrow();
  });

  it('staff can get a fresh signing link while the contract is pending', async () => {
    const member = await newCard();
    const flow = await order(member.id, 10000);
    const fresh = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/sign-url`);
    expect(fresh.status).toBe(201);
    expect(fresh.body.signUrl).toMatch(/^https:\/\/smlh5\.esign\.cn\/sign\//);
    expect((await as(tokens.clerkB).post(`/sign-flows/${flow.id}/sign-url`)).status).toBe(404);
    fake.complete(await esignIdOf(flow.id));
    await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`);
    expect((await as(tokens.clerkA).post(`/sign-flows/${flow.id}/sign-url`)).status).toBe(409);
  });

  it('gives staff the member mini program code to show the customer', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const bodies: string[] = [];
    app.get(MemberAppCodeService).fetchImpl = async (_url, init) => {
      bodies.push(init.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) as ArrayBuffer,
      };
    };
    const response = await as(tokens.clerkA).get('/member-app/code');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ image: `data:image/png;base64,${png.toString('base64')}`, demo: false, message: null });
    expect(bodies[0]).not.toContain('test-member-secret');

    const member = await newCard();
    const memberToken = await memberLogin(member.phone);
    expect((await as(memberToken).get('/member-app/code')).status).toBe(403);
    expect((await http().get('/member-app/code')).status).toBe(401);
  });
});
