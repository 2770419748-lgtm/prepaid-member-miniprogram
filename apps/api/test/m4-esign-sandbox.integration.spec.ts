import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { EsignClient } from '../src/esign/client/esign.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { FAKE_PDF, FakeEsign } from './support/fake-esign';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';

interface FlowBody {
  id: string;
  status: string;
  env: string;
  signUrl: string | null;
  hasPdf: boolean;
  member: { id: string; phone: string };
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
}

/**
 * M4 验收：权益方案、模板绑定、发起签署（会员个人签 + 平台自动盖章）、回调验签、主动刷新、
 * 合同 PDF 归档、撤销、权限范围、正式开关护栏。
 * e签宝用本机假沙箱代替（独立校验请求签名）。操作记录和流水只追加，所以不清理数据，每次用新组织。
 */
describe('M4 esign sandbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  const fake = new FakeEsign('sandbox-app-id', 'sandbox-app-secret');
  const storageDir = mkdtempSync(join(tmpdir(), 'm4-storage-'));
  const savedEnv = { ...process.env };
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let planId = '';
  let templateId = '';
  let noSealTemplateId = '';
  const tokens = { super: '', managerA: '', clerkA: '', clerkB: '', memberX: '', memberY: '' };
  const memberIds = { x: '', y: '' };
  const phones = {
    super: randomPhone(),
    managerA: randomPhone(),
    clerkA: randomPhone(),
    clerkB: randomPhone(),
    memberX: randomPhone(),
    memberY: randomPhone(),
  };
  let flowX = '';

  function http() {
    return request(app.getHttpServer());
  }

  function as(token: string) {
    return {
      get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body?: object) =>
        http().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
      patch: (url: string, body: object) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    };
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

  function webhook(payload: object, headers?: Record<string, string>) {
    const raw = JSON.stringify(payload);
    return http()
      .post('/webhooks/esign')
      .set(headers ?? fake.callbackHeaders(raw))
      .send(raw);
  }

  async function esignIdOf(flowId: string): Promise<string> {
    const flow = await prisma.signFlow.findUniqueOrThrow({ where: { id: flowId } });
    return flow.esignFlowId!;
  }

  beforeAll(async () => {
    await fake.start();
    fake.templates.set('tpl-benefit', {
      name: '储值会员权益单',
      componentKeys: ['memberPhone', 'benefitTitle', 'signDate', 'contractNo'],
      keywords: ['会员签字', '商家盖章'],
    });
    fake.templates.set('tpl-no-seal', {
      name: '缺盖章位置',
      componentKeys: ['memberPhone'],
      keywords: ['会员签字'],
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
    process.env.ESIGN_NOTIFY_URL = 'https://api.example.invalid/webhooks/esign';
    process.env.ESIGN_REDIRECT_URL = 'https://h5.example.invalid/signed';
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

    const org = await prisma.org.create({ data: { name: `电子签测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '社区店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '旗舰店长', StaffRole.STORE_MANAGER, storeA],
      ['clerkA', '旗舰店员', StaffRole.STAFF, storeA],
      ['clerkB', '社区店员', StaffRole.STAFF, storeB],
    ];
    for (const [key, name, role, storeId] of people) {
      await prisma.staff.create({
        data: {
          orgId,
          phone: phones[key],
          name,
          status: 'ACTIVE',
          storeRoles: { create: { storeId, role } },
        },
      });
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
    wechat.bind('memberX', phones.memberX);
    wechat.bind('memberY', phones.memberY);
    const x = await memberLogin('memberX');
    const y = await memberLogin('memberY');
    tokens.memberX = x.token;
    tokens.memberY = y.token;
    memberIds.x = x.id;
    memberIds.y = y.id;
  });

  afterAll(async () => {
    await app?.close();
    await fake.stop();
    rmSync(storageDir, { recursive: true, force: true });
    process.env = savedEnv;
  });

  describe('benefit plans and templates', () => {
    it('only the super admin maintains plans; staff can read them', async () => {
      const body = {
        title: '储值会员权益',
        summary: '全部门店通用',
        items: [{ title: '全场 9 折' }, { title: '生日月赠护理一次', detail: '限本人' }, { title: '免费停车 2 小时' }],
        rules: '储值终身有效，用完为止。',
      };
      expect((await as(tokens.clerkA).post('/benefit-plans', body)).status).toBe(403);
      expect((await as(tokens.managerA).post('/benefit-plans', body)).status).toBe(403);
      const created = await as(tokens.super).post('/benefit-plans', body);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ title: '储值会员权益', status: 'ACTIVE', templateCount: 0 });
      expect(created.body.items[1]).toEqual({ title: '生日月赠护理一次', detail: '限本人' });
      planId = created.body.id as string;

      const listed = await as(tokens.clerkB).get('/benefit-plans');
      expect(listed.status).toBe(200);
      expect(listed.body.items.map((plan: { id: string }) => plan.id)).toContain(planId);

      const empty = await as(tokens.super).post('/benefit-plans', { title: '空', items: [] });
      expect(empty.status).toBe(400);
    });

    it('binding a template checks it exists in the e-sign sandbox', async () => {
      const missing = await as(tokens.super).post('/contract-templates', {
        esignTemplateId: 'tpl-unknown',
        name: '不存在的模板',
      });
      expect(missing.status).toBe(400);
      expect(messageOf(missing.body)).toContain('e签宝里找不到这个模板');

      expect(
        (await as(tokens.clerkA).post('/contract-templates', { esignTemplateId: 'tpl-benefit', name: 'x' })).status,
      ).toBe(403);

      const created = await as(tokens.super).post('/contract-templates', {
        esignTemplateId: 'tpl-benefit',
        name: '储值会员权益单',
        benefitPlanId: planId,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        status: 'ACTIVE',
        benefitPlan: { id: planId, title: '储值会员权益' },
        memberSignKeyword: '会员签字',
        sealKeyword: '商家盖章',
      });
      templateId = created.body.id as string;

      const noSeal = await as(tokens.super).post('/contract-templates', {
        esignTemplateId: 'tpl-no-seal',
        name: '缺盖章位置',
      });
      expect(noSeal.status).toBe(201);
      noSealTemplateId = noSeal.body.id as string;

      const audit = await prisma.auditLog.findMany({ where: { orgId, action: 'CONTRACT_TEMPLATE_CREATE' } });
      expect(audit).toHaveLength(2);
      expect(fake.calls.every((call) => call.signatureOk)).toBe(true);
    });
  });

  describe('initiating a signing flow', () => {
    it('creates a sandbox flow with the member signing first and the company seal auto-applied', async () => {
      const response = await as(tokens.clerkA).post('/sign-flows', {
        memberId: memberIds.x,
        templateId,
        storeId: storeA,
      });
      expect(response.status).toBe(201);
      const flow = response.body as FlowBody;
      expect(flow).toMatchObject({
        status: 'PENDING',
        env: 'SANDBOX',
        hasPdf: false,
        member: { id: memberIds.x, phone: phones.memberX },
        store: { id: storeA, name: '旗舰店' },
        initiator: { name: '旗舰店员' },
      });
      expect(flow.signUrl).toMatch(/^https:\/\/smlh5\.esign\.cn\/sign\//);
      flowX = flow.id;

      const fill = fake.callsTo('/v3/files/create-by-doc-template').at(-1)!.body as {
        components: { componentKey: string; componentValue: string }[];
      };
      const keys = fill.components.map((component) => component.componentKey).sort();
      expect(keys).toEqual(['benefitTitle', 'contractNo', 'memberPhone', 'signDate']);
      expect(fill.components.find((c) => c.componentKey === 'memberPhone')!.componentValue).toBe(phones.memberX);

      const created = fake.callsTo('/v3/sign-flow/create-by-file').at(-1)!.body as {
        signFlowConfig: { notifyUrl?: string; redirectConfig?: { redirectUrl: string }; autoFinish: boolean };
        signers: {
          signerType: number;
          signConfig: { signOrder: number };
          psnSignerInfo?: { psnAccount: string; psnInfo?: unknown };
          orgSignerInfo?: unknown;
          signFields: { normalSignFieldConfig: { autoSign: boolean; signFieldPosition: { positionPage: string } } }[];
        }[];
      };
      expect(created.signFlowConfig).toMatchObject({
        autoFinish: true,
        notifyUrl: 'https://api.example.invalid/webhooks/esign',
        redirectConfig: { redirectUrl: 'https://h5.example.invalid/signed' },
      });
      const [person, company] = created.signers;
      expect(person).toMatchObject({ signerType: 0, signConfig: { signOrder: 1 } });
      // 只传手机号，不把开卡登记的称呼当实名传过去。
      expect(person.psnSignerInfo).toEqual({ psnAccount: phones.memberX });
      expect(person.signFields[0].normalSignFieldConfig.autoSign).toBe(false);
      expect(company).toMatchObject({ signerType: 1, signConfig: { signOrder: 2 } });
      expect(company.orgSignerInfo).toBeUndefined();
      expect(company.signFields[0].normalSignFieldConfig).toMatchObject({
        autoSign: true,
        signFieldPosition: { positionPage: '2' },
      });
      expect(fake.calls.every((call) => call.signatureOk)).toBe(true);

      const audit = await prisma.auditLog.findMany({ where: { orgId, action: 'SIGN_FLOW_CREATE', targetId: flowX } });
      expect(audit).toHaveLength(1);
      expect(audit[0].storeId).toBe(storeA);
      expect(audit[0].payloadJson).toEqual({ memberId: memberIds.x, templateId, env: 'SANDBOX' });
      expect(JSON.stringify(audit[0].payloadJson)).not.toContain('http');
    });

    it('refuses a second unfinished flow for the same member and template', async () => {
      const again = await as(tokens.managerA).post('/sign-flows', { memberId: memberIds.x, templateId, storeId: storeA });
      expect(again.status).toBe(409);
      expect(messageOf(again.body)).toContain('没签完');
      const rows = await prisma.signFlow.count({ where: { memberId: memberIds.x, templateId } });
      expect(rows).toBe(1);
    });

    it('replays a repeated request id instead of creating a second flow', async () => {
      const requestId = randomUUID();
      const body = { memberId: memberIds.y, templateId, storeId: storeA, requestId };
      const first = await as(tokens.clerkA).post('/sign-flows', body);
      expect(first.status).toBe(201);
      const second = await as(tokens.clerkA).post('/sign-flows', body);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.signFlow.count({ where: { memberId: memberIds.y, templateId } })).toBe(1);
    });

    it('rejects a store outside the operator scope', async () => {
      const response = await as(tokens.clerkB).post('/sign-flows', { memberId: memberIds.x, templateId: noSealTemplateId, storeId: storeA });
      expect(response.status).toBe(403);
    });

    it('fails cleanly when the template has no seal position', async () => {
      const response = await as(tokens.clerkA).post('/sign-flows', {
        memberId: memberIds.x,
        templateId: noSealTemplateId,
        storeId: storeA,
      });
      expect(response.status).toBe(400);
      expect(messageOf(response.body)).toContain('找不到「商家盖章」');
      expect(await prisma.signFlow.count({ where: { templateId: noSealTemplateId } })).toBe(0);
    });

    it('the database allows only one unfinished flow per member and template', async () => {
      const existing = await prisma.signFlow.findUniqueOrThrow({ where: { id: flowX } });
      await expect(
        prisma.signFlow.create({
          data: { orgId, memberId: existing.memberId, templateId, status: 'DRAFT' },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('visibility', () => {
    it('store staff only see flows initiated in their own stores', async () => {
      const own = await as(tokens.clerkA).get('/sign-flows');
      expect(own.status).toBe(200);
      expect(own.body.items.map((flow: FlowBody) => flow.id)).toContain(flowX);
      const other = await as(tokens.clerkB).get('/sign-flows');
      expect(other.body.total).toBe(0);
      expect((await as(tokens.clerkB).get(`/sign-flows/${flowX}`)).status).toBe(404);
      expect((await as(tokens.super).get(`/sign-flows/${flowX}`)).status).toBe(200);
    });

    it('a member sees only their own flows, without staff details', async () => {
      const mine = await as(tokens.memberX).get('/members/me/sign-flows');
      expect(mine.status).toBe(200);
      expect(mine.body.total).toBe(1);
      const item = mine.body.items[0] as Record<string, unknown>;
      expect(item).toMatchObject({ id: flowX, status: 'PENDING', sandbox: true, hasPdf: false });
      expect(item.benefitPlan).toMatchObject({ title: '储值会员权益' });
      expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['initiator']));
      expect(JSON.stringify(item)).not.toContain('旗舰店员');
      expect(JSON.stringify(item)).not.toContain('signUrl');

      expect((await as(tokens.memberY).get(`/members/me/sign-flows/${flowX}`)).status).toBe(404);
      expect((await as(tokens.memberY).post(`/members/me/sign-flows/${flowX}/sign-url`)).status).toBe(404);
      expect((await as(tokens.memberX).get('/sign-flows')).status).toBe(403);
      expect((await as(tokens.clerkA).get('/members/me/sign-flows')).status).toBe(403);
    });

    it('a member gets a fresh signing link while the flow is pending', async () => {
      const response = await as(tokens.memberX).post(`/members/me/sign-flows/${flowX}/sign-url`);
      expect(response.status).toBe(201);
      expect(response.body.sandbox).toBe(true);
      expect(response.body.signUrl).toMatch(/^https:\/\/smlh5\.esign\.cn\/sign\//);
      const call = fake.callsTo(`/v3/sign-flow/${await esignIdOf(flowX)}/sign-url`).at(-1)!;
      expect((call.body as { operator: { psnAccount: string } }).operator.psnAccount).toBe(phones.memberX);
    });
  });

  describe('callback', () => {
    it('rejects callbacks with a bad signature, a wrong secret or a stale timestamp, and changes nothing', async () => {
      const esignFlowId = await esignIdOf(flowX);
      fake.complete(esignFlowId);
      const payload = { action: 'SIGN_FLOW_COMPLETE', signFlowId: esignFlowId, signFlowStatus: '2' };
      const raw = JSON.stringify(payload);

      const tampered = fake.callbackHeaders(raw);
      tampered['X-Tsign-Open-SIGNATURE'] = tampered['X-Tsign-Open-SIGNATURE'].replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
      expect((await webhook(payload, tampered)).status).toBe(401);
      expect((await webhook(payload, fake.callbackHeaders(raw, { secret: 'wrong-secret' }))).status).toBe(401);
      expect(
        (await webhook(payload, fake.callbackHeaders(raw, { timestamp: Date.now() - 60 * 60 * 1000 }))).status,
      ).toBe(401);
      expect((await http().post('/webhooks/esign').set('Content-Type', 'application/json').send(raw)).status).toBe(401);

      const flow = await prisma.signFlow.findUniqueOrThrow({ where: { id: flowX } });
      expect(flow.status).toBe('PENDING');
      expect(flow.pdfObjectKey).toBeNull();
    });

    it('a verified callback marks the flow signed and archives the contract PDF', async () => {
      const esignFlowId = await esignIdOf(flowX);
      const response = await webhook({ action: 'SIGN_FLOW_COMPLETE', signFlowId: esignFlowId, signFlowStatus: '2' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ code: '200', msg: 'success' });

      const flow = await prisma.signFlow.findUniqueOrThrow({ where: { id: flowX } });
      expect(flow.status).toBe('SIGNED');
      expect(flow.signedAt).not.toBeNull();
      expect(flow.signUrl).toBeNull();
      expect(flow.pdfObjectKey).toBe(`contracts/${orgId}/${flowX}.pdf`);
      expect(readFileSync(join(storageDir, flow.pdfObjectKey!))).toEqual(FAKE_PDF);

      const changes = await prisma.auditLog.findMany({
        where: { orgId, action: 'SIGN_FLOW_STATUS_CHANGE', targetId: flowX },
      });
      expect(changes).toHaveLength(1);
      expect(changes[0].actorStaffId).toBeNull();
      expect(changes[0].payloadJson).toMatchObject({ from: 'PENDING', to: 'SIGNED', source: 'webhook' });

      // e签宝重发同一条回调：不重复记状态变化。
      expect((await webhook({ action: 'SIGN_FLOW_COMPLETE', signFlowId: esignFlowId })).status).toBe(200);
      expect(
        await prisma.auditLog.count({ where: { orgId, action: 'SIGN_FLOW_STATUS_CHANGE', targetId: flowX } }),
      ).toBe(1);
    });

    it('acknowledges callbacks for flows this system does not know', async () => {
      const response = await webhook({ action: 'SIGN_FLOW_COMPLETE', signFlowId: 'not-ours' });
      expect(response.status).toBe(200);
    });

    it('the member and the store can download the signed PDF; others cannot', async () => {
      const member = await as(tokens.memberX).get(`/members/me/sign-flows/${flowX}/pdf`).buffer(true);
      expect(member.status).toBe(200);
      expect(member.headers['content-type']).toContain('application/pdf');
      expect(Buffer.from(member.body as Buffer)).toEqual(FAKE_PDF);
      expect((await as(tokens.clerkA).get(`/sign-flows/${flowX}/pdf`)).status).toBe(200);
      expect((await as(tokens.clerkB).get(`/sign-flows/${flowX}/pdf`)).status).toBe(404);
      expect((await as(tokens.memberY).get(`/members/me/sign-flows/${flowX}/pdf`)).status).toBe(404);

      const detail = await as(tokens.memberX).get(`/members/me/sign-flows/${flowX}`);
      expect(detail.body).toMatchObject({ status: 'SIGNED', hasPdf: true });
      expect((await as(tokens.memberX).post(`/members/me/sign-flows/${flowX}/sign-url`)).status).toBe(409);
    });

    it('the member benefits list puts the signed plan first', async () => {
      const response = await as(tokens.memberX).get('/members/me/benefits');
      expect(response.status).toBe(200);
      expect(response.body[0]).toMatchObject({
        id: planId,
        items: [{ title: '全场 9 折' }, { title: '生日月赠护理一次' }, { title: '免费停车 2 小时' }],
        signFlow: { id: flowX, status: 'SIGNED' },
      });
    });
  });

  describe('refresh and cancel', () => {
    it('refresh syncs the status and retries archiving until the PDF is stored', async () => {
      const flow = await prisma.signFlow.findFirstOrThrow({ where: { memberId: memberIds.y, templateId } });
      fake.complete(flow.esignFlowId!);
      fake.failDownload = true;
      const first = await as(tokens.memberY).post(`/members/me/sign-flows/${flow.id}/refresh`);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ status: 'SIGNED', hasPdf: false });

      fake.failDownload = false;
      const second = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/refresh`);
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ status: 'SIGNED', hasPdf: true });
      const change = await prisma.auditLog.findFirstOrThrow({
        where: { orgId, action: 'SIGN_FLOW_STATUS_CHANGE', targetId: flow.id },
      });
      expect(change.payloadJson).toMatchObject({ source: 'refresh' });
    });

    it('only a super admin or the store manager can cancel a pending flow', async () => {
      const created = await as(tokens.clerkA).post('/sign-flows', { memberId: memberIds.x, templateId, storeId: storeA });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      expect((await as(tokens.clerkA).post(`/sign-flows/${id}/cancel`, { reason: '发错了' })).status).toBe(403);
      const canceled = await as(tokens.managerA).post(`/sign-flows/${id}/cancel`, { reason: '发错了' });
      expect(canceled.status).toBe(201);
      expect(canceled.body).toMatchObject({ status: 'CANCELED', signUrl: null });
      expect(fake.flows.get(await esignIdOf(id))!.status).toBe(3);
      expect((await as(tokens.managerA).post(`/sign-flows/${id}/cancel`, { reason: '再撤' })).status).toBe(409);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId, action: 'SIGN_FLOW_CANCEL', targetId: id } });
      expect(audit.payloadJson).toMatchObject({ reason: '发错了' });

      // 撤销后可以重新发起。
      const again = await as(tokens.clerkA).post('/sign-flows', { memberId: memberIds.x, templateId, storeId: storeA });
      expect(again.status).toBe(201);
    });
  });

  describe('production switch guard', () => {
    it('with the switch off, a production gateway is refused before anything is written or sent', async () => {
      process.env.ESIGN_API_HOST = 'https://openapi.esign.cn';
      try {
        const callsBefore = fake.calls.length;
        const rowsBefore = await prisma.signFlow.count({ where: { orgId } });
        const response = await as(tokens.clerkA).post('/sign-flows', {
          memberId: memberIds.y,
          templateId: noSealTemplateId,
          storeId: storeA,
        });
        expect(response.status).toBe(503);
        expect(messageOf(response.body)).toContain('正式签署未开启');
        expect(await prisma.signFlow.count({ where: { orgId } })).toBe(rowsBefore);
        expect(
          (await as(tokens.super).post('/contract-templates', { esignTemplateId: 'tpl-benefit', name: '正式' })).status,
        ).toBe(503);
        expect(fake.calls.length).toBe(callsBefore);
      } finally {
        process.env.ESIGN_API_HOST = fake.baseUrl;
      }
    });

    it('every flow written while the switch is off is a sandbox flow', async () => {
      const envs = await prisma.signFlow.groupBy({ by: ['env'], where: { orgId }, _count: true });
      expect(envs.map((row) => row.env)).toEqual(['SANDBOX']);
    });
  });
});
