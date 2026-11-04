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
 * 微信审核体验入口（上线清单 D）：超级管理员打开 7 天，审核员用账号密码登进单独的演示公司，
 * 碰不到真实数据；关掉或到期后入口消失、已有登录马上失效。
 * 测试库里有很多家公司，所以这里都带上 orgId（正式环境只有一家，小程序不传）。
 */
describe('review demo entry', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeId = '';
  let realMemberPhone = '';
  const tokens = { super: '', manager: '' };

  function http() {
    return request(app.getHttpServer());
  }

  function enabled() {
    return http().get('/auth/review-demo').query({ orgId });
  }

  function reviewLogin(password: string, account = 'shenhe') {
    return http().post('/auth/review-demo/login').send({ account, password, orgId });
  }

  function admin(path: '' | '/open' | '/password' | '/close', token = tokens.super) {
    const url = `/review-demo${path}`;
    return path === '' ? http().get(url).set('Authorization', `Bearer ${token}`) : http().post(url).set('Authorization', `Bearer ${token}`);
  }

  async function demoOrgId(): Promise<string> {
    return (await prisma.org.findUniqueOrThrow({ where: { demoOfId: orgId } })).id;
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

    const org = await prisma.org.create({ data: { name: `审核入口测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeId = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    for (const [key, role] of [
      ['super', StaffRole.SUPER_ADMIN],
      ['manager', StaffRole.STORE_MANAGER],
    ] as const) {
      const phone = randomPhone();
      await prisma.staff.create({
        data: { orgId, phone, name: key, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      wechat.bind(key, phone);
      const login = await http().post('/auth/staff/wx-phone').send({ code: key, phoneCode: 'phone', orgId });
      expect(login.status).toBe(201);
      tokens[key] = login.body.accessToken as string;
    }
    realMemberPhone = randomPhone();
    const card = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ phone: realMemberPhone, storeId, name: '真实会员' });
    expect(card.status).toBe(201);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('is closed until a super admin opens it, and only a super admin can see or open it', async () => {
    expect((await enabled()).body).toEqual({ enabled: false });
    const login = await reviewLogin('whatever-password');
    expect(login.status).toBe(403);
    expect(messageOf(login.body)).toBe('审核体验入口没有打开');

    expect((await admin('', tokens.manager)).status).toBe(403);
    expect((await admin('/open', tokens.manager)).status).toBe(403);

    const status = await admin('');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: false, until: null, account: 'shenhe', days: 7, demo: null });
  });

  let password = '';
  let demoStaffToken = '';
  let demoMemberToken = '';

  it('opens for 7 days with a fresh password and builds the demo company once', async () => {
    const before = Date.now();
    const opened = await admin('/open');
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ enabled: true, account: 'shenhe', demo: { stores: 2, members: 4 } });
    password = opened.body.password as string;
    expect(password).toMatch(/^[a-z2-9]{10}$/);
    const until = new Date(opened.body.until as string).getTime();
    expect(until - before).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 5000);
    expect(until - before).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 5000);

    // 密码只在这次给，查状态时不再返回。
    const status = await admin('');
    expect(status.body.enabled).toBe(true);
    expect(status.body.password).toBeUndefined();
    expect((await enabled()).body).toEqual({ enabled: true });

    const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'REVIEW_DEMO_OPEN' } });
    expect(audit?.payloadJson).toMatchObject({ extended: false, demoCreated: true });
    const stored = await prisma.org.findUniqueOrThrow({ where: { id: orgId } });
    expect(stored.reviewDemoPasswordHash).not.toContain(password);
  });

  it('logs the reviewer into the demo company with the same shape as a staff login', async () => {
    const wrong = await reviewLogin('not-the-password');
    expect(wrong.status).toBe(401);
    expect(messageOf(wrong.body)).toBe('审核账号或密码错误');
    expect((await reviewLogin(password, 'someone')).status).toBe(401);

    const login = await reviewLogin(password, ' ShenHe ');
    expect(login.status).toBe(201);
    const demoId = await demoOrgId();
    expect(login.body).toMatchObject({
      principalType: 'STAFF',
      tokenType: 'Bearer',
      mustChangePassword: false,
      staff: { orgId: demoId, phone: '19900000000', name: '审核体验员', status: 'ACTIVE' },
    });
    expect(login.body.roles).toHaveLength(2);
    expect(login.body.roles.every((role: { role: string }) => role.role === 'STORE_MANAGER')).toBe(true);
    demoStaffToken = login.body.accessToken as string;

    const stores = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(stores.status).toBe(200);
    expect(JSON.stringify(stores.body)).toContain('演示一店');
    expect(JSON.stringify(stores.body)).not.toContain('旗舰店');

    const audit = await prisma.auditLog.findFirst({ where: { orgId, action: 'REVIEW_DEMO_LOGIN' } });
    expect(audit?.targetId).toBe(demoId);
  });

  it('shows only fake data: demo members with balances, nothing from the real company', async () => {
    const demoMember = await http()
      .get('/members')
      .query({ phone: '13900000001' })
      .set('Authorization', `Bearer ${demoStaffToken}`);
    expect(demoMember.status).toBe(200);
    expect(demoMember.body.items[0]).toMatchObject({ name: '王女士（演示）', balanceCent: 73_200 });

    const real = await http()
      .get('/members')
      .query({ phone: realMemberPhone })
      .set('Authorization', `Bearer ${demoStaffToken}`);
    expect(real.status).toBe(200);
    expect(real.body.items).toHaveLength(0);

    const ledger = await http().get('/ledger').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.total).toBe(8);

    // 切到自己的会员卡：演示公司里预先开好了一张。
    const own = await http().post('/auth/staff/member-session').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(own.status).toBe(201);
    expect(own.body.principalType).toBe('MEMBER');
    demoMemberToken = own.body.accessToken as string;
    const me = await http().get('/members/me/wallet').set('Authorization', `Bearer ${demoMemberToken}`);
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain('33300');
  });

  it('lets the reviewer record a demo recharge but never starts a real e-sign contract', async () => {
    const demoId = await demoOrgId();
    const [store, member, template] = await Promise.all([
      prisma.store.findFirstOrThrow({ where: { orgId: demoId, name: '演示一店' } }),
      prisma.member.findFirstOrThrow({ where: { orgId: demoId, phone: '13900000003' } }),
      prisma.contractTemplate.findFirstOrThrow({ where: { orgId: demoId } }),
    ]);
    const recharge = await http()
      .post(`/wallets/${member.id}/recharge`)
      .set('Authorization', `Bearer ${demoStaffToken}`)
      .send({ storeId: store.id, amountCent: 10_000, requestId: randomUUID() });
    expect(recharge.status).toBe(201);
    expect(recharge.body.balanceCent).toBe(30_000);

    const sign = await http()
      .post('/sign-flows')
      .set('Authorization', `Bearer ${demoStaffToken}`)
      .send({ storeId: store.id, memberId: member.id, templateId: template.id, requestId: randomUUID() });
    expect(sign.status).toBe(403);
    expect(messageOf(sign.body)).toContain('审核体验里不发起真实的合同签署');
    expect(await prisma.signFlow.count({ where: { orgId: demoId } })).toBe(0);
  });

  it('keeps normal logins out of the demo company', async () => {
    const demoId = await demoOrgId();
    wechat.bind('demo-staff', '19900000000');
    const staff = await http()
      .post('/auth/wx-phone')
      .send({ code: 'demo-staff', phoneCode: 'phone', orgId: demoId });
    expect(staff.status).toBe(404);
    wechat.bind('demo-member', '13900000001');
    const member = await http()
      .post('/auth/member/wx-phone')
      .send({ code: 'demo-member', phoneCode: 'phone', orgId: demoId });
    expect(member.status).toBe(404);
    const web = await http()
      .post('/auth/staff/password/login')
      .send({ phone: '19900000000', password: password, orgId: demoId });
    expect(web.status).toBe(404);
    // 演示公司里的人也管不了审核入口。
    expect((await admin('', demoStaffToken)).status).toBe(403);
  });

  it('changes the password without logging the reviewer out', async () => {
    const rotated = await admin('/password');
    expect(rotated.status).toBe(201);
    const next = rotated.body.password as string;
    expect(next).not.toBe(password);
    expect((await reviewLogin(password)).status).toBe(401);
    expect((await reviewLogin(next)).status).toBe(201);
    password = next;
    const stores = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(stores.status).toBe(200);
  });

  it('closes: the entry disappears and the reviewer is logged out at once', async () => {
    const closed = await admin('/close');
    expect(closed.status).toBe(201);
    expect(closed.body.enabled).toBe(false);
    expect((await enabled()).body).toEqual({ enabled: false });
    expect((await reviewLogin(password)).status).toBe(403);

    const staff = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(staff.status).toBe(401);
    const member = await http().get('/members/me').set('Authorization', `Bearer ${demoMemberToken}`);
    expect(member.status).toBe(401);

    expect((await admin('/close')).status).toBe(409);
    expect((await admin('/password')).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { orgId, action: 'REVIEW_DEMO_CLOSE' } })).toBe(1);
  });

  it('reopens on the same demo company, and old reviewer logins stay dead', async () => {
    const opened = await admin('/open');
    expect(opened.status).toBe(201);
    expect(await prisma.org.count({ where: { demoOfId: orgId } })).toBe(1);
    const old = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(old.status).toBe(401);

    const login = await reviewLogin(opened.body.password as string);
    expect(login.status).toBe(201);
    demoStaffToken = login.body.accessToken as string;
    password = opened.body.password as string;

    // 再点一次「打开」= 从现在起再算 7 天，已登录的审核员不掉线。
    const extended = await admin('/open');
    expect(extended.status).toBe(201);
    const still = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(still.status).toBe(200);
    password = extended.body.password as string;
  });

  it('expires by itself after the deadline', async () => {
    await prisma.org.update({ where: { id: orgId }, data: { reviewDemoUntil: new Date(Date.now() - 1000) } });
    expect((await enabled()).body).toEqual({ enabled: false });
    expect((await reviewLogin(password)).status).toBe(403);
    const staff = await http().get('/staff/me/stores').set('Authorization', `Bearer ${demoStaffToken}`);
    expect(staff.status).toBe(401);
    expect(messageOf(staff.body)).toBe('审核体验已关闭');
    const status = await admin('');
    expect(status.body.enabled).toBe(false);
  });

  it('locks the review account after five wrong passwords, and opening again unlocks it', async () => {
    const opened = await admin('/open');
    const fresh = opened.body.password as string;
    for (let i = 0; i < 4; i += 1) {
      expect((await reviewLogin('wrong-password')).status).toBe(401);
    }
    const fifth = await reviewLogin('wrong-password');
    expect(fifth.status).toBe(403);
    expect((await reviewLogin(fresh)).status).toBe(403);

    const reopened = await admin('/open');
    expect((await reviewLogin(reopened.body.password as string)).status).toBe(201);
  });
});
