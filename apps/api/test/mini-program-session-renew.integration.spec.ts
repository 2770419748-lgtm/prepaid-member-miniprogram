import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, randomPhone } from './support/fake-wechat';

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const TWELVE_HOURS = 12 * 60 * 60;

/**
 * 两个小程序保持登录：会员小程序、员工小程序（都是微信手机号登录）给 30 天，小程序每天打开时续期，有效期重新算。
 * 网页后台（密码登录）仍是 12 小时，不能续期。
 * 停用、改密、重置密码后，旧登录续不了期，马上失效。
 * 操作记录只能追加，不清理数据；每次运行用一个新的组织。
 */
describe('mini-programs stay signed in', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let superToken = '';

  function http() {
    return request(app.getHttpServer());
  }

  function renew(token: string) {
    return http().post('/auth/staff/session/renew').set('Authorization', `Bearer ${token}`);
  }

  function renewMember(token: string) {
    return http().post('/auth/member/session/renew').set('Authorization', `Bearer ${token}`);
  }

  async function memberLogin(code: string) {
    const phone = randomPhone();
    wechat.bind(code, phone);
    const login = await http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(login.status).toBe(201);
    return { id: login.body.member.id as string, phone, token: login.body.accessToken as string, login };
  }

  function lifetimeOf(token: string): number {
    const payload = jwt.decode(token) as { iat: number; exp: number };
    return payload.exp - payload.iat;
  }

  async function hireAndLogin(code: string, role: StaffRole = StaffRole.STAFF, password?: string) {
    const phone = randomPhone();
    const hired = await http()
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone, name: `员工${code}`, storeId: storeA, role, password: password ?? 'Init12345' });
    expect(hired.status).toBe(201);
    wechat.bind(code, phone);
    const login = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(login.status).toBe(201);
    return { id: hired.body.id as string, phone, token: login.body.accessToken as string, login };
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
    jwt = app.get(JwtService);

    const org = await prisma.org.create({ data: { name: `续期测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    const superPhone = randomPhone();
    await prisma.staff.create({
      data: {
        orgId,
        phone: superPhone,
        name: '超级管理员',
        status: 'ACTIVE',
        storeRoles: { create: { storeId: storeA, role: StaffRole.SUPER_ADMIN } },
      },
    });
    wechat.bind('super', superPhone);
    const superLogin = await http().post('/auth/staff/wx-phone').send({ code: 'super', phoneCode: 'phone', orgId });
    expect(superLogin.status).toBe(201);
    superToken = superLogin.body.accessToken as string;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('gives the staff mini-program 30 days and renews it with a fresh 30 days', async () => {
    const clerk = await hireAndLogin('clerk');
    expect(clerk.login.body.expiresIn).toBe(THIRTY_DAYS);
    expect(lifetimeOf(clerk.token)).toBe(THIRTY_DAYS);

    // 签发时间精确到秒，等过一秒再续，新凭证的到期时间才会往后挪。
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const renewed = await renew(clerk.token);
    expect(renewed.status).toBe(201);
    expect(renewed.body.expiresIn).toBe(THIRTY_DAYS);
    expect(renewed.body.staff).toMatchObject({ id: clerk.id, phone: clerk.phone });
    expect(renewed.body.roles).toEqual([{ storeId: storeA, role: 'STAFF', storeName: '旗舰店' }]);
    const fresh = renewed.body.accessToken as string;
    expect(lifetimeOf(fresh)).toBe(THIRTY_DAYS);
    const oldExp = (jwt.decode(clerk.token) as { exp: number }).exp;
    expect((jwt.decode(fresh) as { exp: number }).exp).toBeGreaterThan(oldExp);

    const stores = await http().get('/staff/me/stores').set('Authorization', `Bearer ${fresh}`);
    expect(stores.status).toBe(200);
  });

  it('keeps the merchant web (password login) at 12 hours without renewal', async () => {
    const manager = await hireAndLogin('web-manager', StaffRole.STORE_MANAGER, 'Init12345');
    const first = await http().post('/auth/staff/password/login').send({ phone: manager.phone, password: 'Init12345', orgId });
    expect(first.status).toBe(201);
    const changed = await http()
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${first.body.accessToken as string}`)
      .send({ currentPassword: 'Init12345', newPassword: 'Changed123' });
    expect(changed.status).toBe(201);

    const web = await http().post('/auth/staff/password/login').send({ phone: manager.phone, password: 'Changed123', orgId });
    expect(web.status).toBe(201);
    expect(web.body.mustChangePassword).toBe(false);
    expect(web.body.expiresIn).toBe(TWELVE_HOURS);
    expect(lifetimeOf(web.body.accessToken as string)).toBe(TWELVE_HOURS);
    const refused = await renew(web.body.accessToken as string);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('只有员工小程序的登录可以续期');
    expect((await renewMember(web.body.accessToken as string)).status).toBe(403);
  });

  it('gives the member mini-program 30 days and renews it with a fresh 30 days', async () => {
    const member = await memberLogin('member');
    expect(member.login.body.expiresIn).toBe(THIRTY_DAYS);
    expect(lifetimeOf(member.token)).toBe(THIRTY_DAYS);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const renewed = await renewMember(member.token);
    expect(renewed.status).toBe(201);
    expect(renewed.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: THIRTY_DAYS,
      principalType: 'MEMBER',
      needsCard: true,
      member: { id: member.id, phone: member.phone },
    });
    const fresh = renewed.body.accessToken as string;
    expect(lifetimeOf(fresh)).toBe(THIRTY_DAYS);
    expect((jwt.decode(fresh) as { exp: number }).exp).toBeGreaterThan((jwt.decode(member.token) as { exp: number }).exp);
    expect((await http().get('/members/me').set('Authorization', `Bearer ${fresh}`)).status).toBe(200);

    // 会员和员工不能互换着续。
    expect((await renew(fresh)).status).toBe(403);
    expect((await renewMember(superToken)).status).toBe(403);
  });

  it('cannot renew after the member is disabled', async () => {
    const member = await memberLogin('member-disabled');
    await prisma.member.update({ where: { id: member.id }, data: { status: 'DISABLED' } });
    expect((await renewMember(member.token)).status).toBe(401);
    expect((await http().get('/members/me').set('Authorization', `Bearer ${member.token}`)).status).toBe(401);
  });

  it('cannot renew after the staff member is disabled', async () => {
    const leaver = await hireAndLogin('leaver');
    const disabled = await http()
      .patch(`/staff/${leaver.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);
    expect((await renew(leaver.token)).status).toBe(401);
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${leaver.token}`)).status).toBe(401);
  });

  it('cannot renew a session issued before a password reset', async () => {
    const clerk = await hireAndLogin('reset');
    const reset = await http()
      .post(`/staff/${clerk.id}/password/reset`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ password: 'Reset12345' });
    expect(reset.status).toBe(201);
    const stale = await renew(clerk.token);
    expect(stale.status).toBe(401);

    // 重新用微信手机号登录就好，小程序不用改密。
    const again = await http().post('/auth/staff/wx-phone').send({ code: 'reset', phoneCode: 'phone', orgId });
    expect(again.status).toBe(201);
    expect((await renew(again.body.accessToken as string)).status).toBe(201);
  });

  it('cannot renew an expired session or without signing in', async () => {
    const clerk = await hireAndLogin('expired');
    const claims = { ...(jwt.decode(clerk.token) as Record<string, unknown>) };
    delete claims.iat;
    delete claims.exp;
    const expired = jwt.sign(claims, { expiresIn: -10 });
    expect((await renew(expired)).status).toBe(401);
    expect((await http().post('/auth/staff/session/renew')).status).toBe(401);
    expect((await http().post('/auth/member/session/renew')).status).toBe(401);
  });
});
