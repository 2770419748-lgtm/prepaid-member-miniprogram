import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, randomPhone } from './support/fake-wechat';

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/**
 * 会员和员工共用一个小程序（2026-11-04）：
 * - POST /auth/wx-phone 微信手机号只换一次。在职员工的手机号直接得到员工登录（进工作台），其他人按会员登录。
 * - 员工停用后再登录就只是会员。
 * - 工作台「切到我的会员卡」：POST /auth/staff/member-session 用员工本人手机号换一张会员登录，只认小程序登录的员工。
 * - 会员的 GET /auth/me 告诉小程序这个手机号能不能进工作台。
 * 流水和操作记录只能追加，不清理数据；每次运行用一个新的组织。
 */
describe('one mini-program for members and staff', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let superToken = '';
  let codeSeq = 0;

  function http() {
    return request(app.getHttpServer());
  }

  /** 每次登录都是一个新的微信凭证（真机上每个手机号凭证只能用一次）。 */
  function signIn(phone: string) {
    codeSeq += 1;
    const code = `merged-${codeSeq}`;
    wechat.bind(code, phone);
    return http().post('/auth/wx-phone').send({ code, phoneCode: 'phone', orgId });
  }

  async function hire(role: StaffRole = StaffRole.STAFF) {
    const phone = randomPhone();
    const hired = await http()
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone, name: `员工${phone.slice(-4)}`, storeId: storeA, role, password: 'Init12345' });
    expect(hired.status).toBe(201);
    return { id: hired.body.id as string, phone };
  }

  function memberSession(token: string) {
    return http().post('/auth/staff/member-session').set('Authorization', `Bearer ${token}`);
  }

  async function membersWithPhone(phone: string) {
    return prisma.member.count({ where: { orgId, phone } });
  }

  beforeAll(async () => {
    process.env.WECHAT_MEMBER_APPID = 'test-mini-program';
    process.env.WECHAT_MEMBER_SECRET = 'test-mini-program-secret';
    process.env.WECHAT_PHONE_MOCK = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatPhoneClient)
      .useValue(wechat)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const org = await prisma.org.create({ data: { name: `合并小程序${Date.now()}`, status: 'ACTIVE' } });
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
    const superLogin = await signIn(superPhone);
    expect(superLogin.status).toBe(201);
    expect(superLogin.body.principalType).toBe('STAFF');
    superToken = superLogin.body.accessToken as string;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('signs a customer in as a member (and creates the member on first sign-in)', async () => {
    const phone = randomPhone();
    const login = await signIn(phone);
    expect(login.status).toBe(201);
    expect(login.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: THIRTY_DAYS,
      principalType: 'MEMBER',
      needsCard: true,
      member: { phone },
    });
    expect(await membersWithPhone(phone)).toBe(1);
    const token = login.body.accessToken as string;
    expect((await http().get('/members/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    // 会员拿不到员工接口。
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${token}`)).status).toBe(403);

    const me = await http().get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ principalType: 'MEMBER', workbench: false });

    // 同一个人第二次登录还是同一位会员。
    const again = await signIn(phone);
    expect(again.body.member.id).toBe(login.body.member.id);
    expect(await membersWithPhone(phone)).toBe(1);
  });

  it('sends an active staff member straight to the workbench without creating a member', async () => {
    const clerk = await hire();
    const login = await signIn(clerk.phone);
    expect(login.status).toBe(201);
    expect(login.body).toMatchObject({
      expiresIn: THIRTY_DAYS,
      principalType: 'STAFF',
      mustChangePassword: true,
      staff: { id: clerk.id, phone: clerk.phone },
      roles: [{ storeId: storeA, role: 'STAFF', storeName: '旗舰店' }],
    });
    const token = login.body.accessToken as string;
    // 小程序登录不用先改网页后台的初始密码。
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await http().post('/auth/staff/session/renew').set('Authorization', `Bearer ${token}`)).status).toBe(201);
    expect(await membersWithPhone(clerk.phone)).toBe(0);
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: clerk.id } });
    expect(staff.wxOpenId).toBe(`openid-${clerk.phone}`);
  });

  it('switches a staff member to their own member card and back again', async () => {
    const clerk = await hire(StaffRole.STORE_MANAGER);
    const staffLogin = await signIn(clerk.phone);
    const staffToken = staffLogin.body.accessToken as string;

    const switched = await memberSession(staffToken);
    expect(switched.status).toBe(201);
    expect(switched.body).toMatchObject({
      expiresIn: THIRTY_DAYS,
      principalType: 'MEMBER',
      needsCard: true,
      member: { phone: clerk.phone },
    });
    const memberToken = switched.body.accessToken as string;
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${memberToken}`);
    expect(me.body).toMatchObject({ principalType: 'MEMBER', workbench: true, member: { phone: clerk.phone } });
    const created = await prisma.member.findFirstOrThrow({ where: { orgId, phone: clerk.phone } });
    expect(created.wxOpenId).toBe(`openid-${clerk.phone}`);

    // 再切一次还是同一张卡，不会重复建会员；员工登录本身不受影响。
    const second = await memberSession(staffToken);
    expect(second.body.member.id).toBe(switched.body.member.id);
    expect(await membersWithPhone(clerk.phone)).toBe(1);
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${staffToken}`)).status).toBe(200);

    // 会员凭证不能反过来换员工，也不能拿去调员工接口。
    expect((await memberSession(memberToken)).status).toBe(403);
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403);
  });

  it('uses the existing member card when the staff member was already a customer', async () => {
    const phone = randomPhone();
    const asCustomer = await signIn(phone);
    expect(asCustomer.body.principalType).toBe('MEMBER');
    const memberId = asCustomer.body.member.id as string;

    const hired = await http()
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone, name: '老顾客入职', storeId: storeA, role: 'STAFF', password: 'Init12345' });
    expect(hired.status).toBe(201);

    // 还没重新登录时，会员的「我的」页能看出这个手机号可以进工作台。
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${asCustomer.body.accessToken as string}`);
    expect(me.body.workbench).toBe(true);

    const asStaff = await signIn(phone);
    expect(asStaff.body.principalType).toBe('STAFF');
    const switched = await memberSession(asStaff.body.accessToken as string);
    expect(switched.body.member.id).toBe(memberId);
  });

  it('treats a disabled staff member as a member only', async () => {
    const leaver = await hire();
    const before = await signIn(leaver.phone);
    expect(before.body.principalType).toBe('STAFF');
    const disabled = await http()
      .patch(`/staff/${leaver.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);

    // 旧的员工登录马上失效，也切不了会员卡。
    expect((await memberSession(before.body.accessToken as string)).status).toBe(401);

    const after = await signIn(leaver.phone);
    expect(after.status).toBe(201);
    expect(after.body.principalType).toBe('MEMBER');
    expect(after.body.member.phone).toBe(leaver.phone);
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${after.body.accessToken as string}`);
    expect(me.body.workbench).toBe(false);
  });

  it('refuses the member switch for the merchant web password login', async () => {
    const manager = await hire(StaffRole.STORE_MANAGER);
    const first = await http().post('/auth/staff/password/login').send({ phone: manager.phone, password: 'Init12345', orgId });
    const changed = await http()
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${first.body.accessToken as string}`)
      .send({ currentPassword: 'Init12345', newPassword: 'Changed123' });
    expect(changed.status).toBe(201);
    const web = await http().post('/auth/staff/password/login').send({ phone: manager.phone, password: 'Changed123', orgId });
    expect(web.status).toBe(201);
    const refused = await memberSession(web.body.accessToken as string);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('请在小程序里用微信手机号登录后再切换');
    expect(await membersWithPhone(manager.phone)).toBe(0);
  });

  it('signs out the old phone when the super admin changes a staff phone number', async () => {
    const clerk = await hire();
    const login = await signIn(clerk.phone);
    const token = login.body.accessToken as string;
    const newPhone = randomPhone();
    const changed = await http()
      .patch(`/staff/${clerk.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: newPhone });
    expect(changed.status).toBe(200);
    expect((await http().get('/staff/me/stores').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await memberSession(token)).status).toBe(401);
    expect(await membersWithPhone(newPhone)).toBe(0);

    // 旧号再登录只是会员；新号登录才进工作台。
    expect((await signIn(clerk.phone)).body.principalType).toBe('MEMBER');
    const fresh = await signIn(newPhone);
    expect(fresh.body.principalType).toBe('STAFF');
    expect(fresh.body.staff.id).toBe(clerk.id);

    // 只改名字不动登录。
    const renamed = await http()
      .patch(`/staff/${clerk.id}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: '改了名字', phone: newPhone });
    expect(renamed.status).toBe(200);
    expect(
      (await http().get('/staff/me/stores').set('Authorization', `Bearer ${fresh.body.accessToken as string}`)).status,
    ).toBe(200);
  });

  it('keeps refusing a disabled member who is not staff', async () => {
    const phone = randomPhone();
    const login = await signIn(phone);
    await prisma.member.update({ where: { id: login.body.member.id as string }, data: { status: 'DISABLED' } });
    const refused = await signIn(phone);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('账号已停用');
  });
});
