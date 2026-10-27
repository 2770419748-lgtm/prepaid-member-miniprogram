import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeWechat, randomPhone } from './support/fake-wechat';
import { scanPayCode } from './support/pay-code';

/**
 * 服务端强制首次改密：用初始密码（或被重置的密码）登录网页后台后，改密前只能改密码、看本人信息。
 * 改密、重置密码后之前的登录全部作废。员工小程序（微信手机号登录）和会员不受影响。
 * 操作记录和流水只能追加，所以不清理数据；每次运行用一个新的组织。
 */
describe('forced password change on the server', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let superToken = '';
  let memberId = '';
  let memberToken = '';
  let managerId = '';
  const managerPhone = randomPhone();
  const initialPassword = 'Init12345';

  function http() {
    return request(app.getHttpServer());
  }

  function passwordLogin(password: string) {
    return http().post('/auth/staff/password/login').send({ phone: managerPhone, password, orgId });
  }

  function recharge(token: string, amountCent = 1000) {
    return http()
      .post(`/wallets/${memberId}/recharge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: storeA, amountCent, requestId: randomUUID() });
  }

  function consume(token: string, payCode: string, amountCent = 500) {
    return http()
      .post(`/wallets/${memberId}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storeId: storeA, amountCent, payCode, requestId: randomUUID() });
  }

  function reverse(token: string, entryId: string) {
    return http()
      .post(`/ledger/${entryId}/reversal`)
      .set('Authorization', `Bearer ${token}`)
      .send({ remark: '录错了', requestId: randomUUID() });
  }

  async function balance(): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
  }

  function expectMustChange(response: request.Response): void {
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'MUST_CHANGE_PASSWORD', message: '请先修改初始密码' });
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

    const org = await prisma.org.create({ data: { name: `改密测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;

    // 超级管理员新建时 mustChangePassword 默认就是 true，但他用微信手机号登录员工小程序，不受影响。
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
    expect(superLogin.body.mustChangePassword).toBe(true);
    superToken = superLogin.body.accessToken as string;

    const hired = await http()
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: managerPhone, name: '张店长', storeId: storeA, role: 'STORE_MANAGER', password: initialPassword });
    expect(hired.status).toBe(201);
    managerId = hired.body.id as string;

    const memberPhone = randomPhone();
    const card = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: memberPhone, storeId: storeA });
    expect(card.status).toBe(201);
    memberId = card.body.id as string;
    wechat.bind('member', memberPhone);
    const memberLogin = await http().post('/auth/member/wx-phone').send({ code: 'member', phoneCode: 'phone', orgId });
    expect(memberLogin.status).toBe(201);
    memberToken = memberLogin.body.accessToken as string;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('lets mini-program staff (WeChat phone login) keep working without changing a web password', async () => {
    const funded = await recharge(superToken, 5000);
    expect(funded.status).toBe(201);
    expect(await balance()).toBe(5000);
  });

  it('blocks recharge, deduction and reversal for a session opened with the initial password', async () => {
    const login = await passwordLogin(initialPassword);
    expect(login.status).toBe(201);
    expect(login.body.mustChangePassword).toBe(true);
    const pending = login.body.accessToken as string;

    const me = await http().get('/auth/me').set('Authorization', `Bearer ${pending}`);
    expect(me.status).toBe(200);
    expect(me.body.staff.mustChangePassword).toBe(true);

    const before = await balance();
    const entries = await prisma.ledgerEntry.count({ where: { memberId } });
    const someEntry = await prisma.ledgerEntry.findFirstOrThrow({ where: { memberId } });

    expectMustChange(await recharge(pending));
    expectMustChange(await consume(pending, '800000000000000000'));
    expectMustChange(await reverse(pending, someEntry.id));
    expectMustChange(await http().get('/staff/me/stores').set('Authorization', `Bearer ${pending}`));
    expectMustChange(await http().get('/ledger').set('Authorization', `Bearer ${pending}`));
    expectMustChange(
      await http()
        .post('/pay-codes/scan')
        .set('Authorization', `Bearer ${pending}`)
        .send({ code: '800000000000000000', storeId: storeA }),
    );
    expectMustChange(
      await http()
        .post('/staff')
        .set('Authorization', `Bearer ${pending}`)
        .send({ phone: randomPhone(), name: '偷建的人', storeId: storeA, role: 'STAFF', password: 'Init12345' }),
    );

    expect(await balance()).toBe(before);
    expect(await prisma.ledgerEntry.count({ where: { memberId } })).toBe(entries);
  });

  it('works normally after the change, and the session used to change it is no longer valid', async () => {
    const pending = (await passwordLogin(initialPassword)).body.accessToken as string;
    const changed = await http()
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${pending}`)
      .send({ currentPassword: initialPassword, newPassword: 'Changed123' });
    expect(changed.status).toBe(201);
    expect(changed.body).toEqual({ mustChangePassword: false });

    const stale = await http().get('/auth/me').set('Authorization', `Bearer ${pending}`);
    expect(stale.status).toBe(401);
    expect((await recharge(pending)).status).toBe(401);

    const fresh = await passwordLogin('Changed123');
    expect(fresh.status).toBe(201);
    expect(fresh.body.mustChangePassword).toBe(false);
    const token = fresh.body.accessToken as string;

    const before = await balance();
    const added = await recharge(token, 2000);
    expect(added.status).toBe(201);
    const payCode = await scanPayCode(app, orgId, token, memberId, storeA);
    const spent = await consume(token, payCode, 700);
    expect(spent.status).toBe(201);
    const undone = await reverse(token, added.body.entry.id as string);
    expect(undone.status).toBe(201);
    expect(await balance()).toBe(before + 2000 - 700 - 2000);
  });

  it('blocks again after a super admin resets the password, and logs out every earlier session', async () => {
    const working = (await passwordLogin('Changed123')).body.accessToken as string;
    expect((await recharge(working)).status).toBe(201);
    wechat.bind('manager', managerPhone);
    const mini = await http().post('/auth/staff/wx-phone').send({ code: 'manager', phoneCode: 'phone', orgId });
    expect(mini.status).toBe(201);
    const miniBefore = mini.body.accessToken as string;

    const reset = await http()
      .post(`/staff/${managerId}/password/reset`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ password: 'Reset12345' });
    expect(reset.status).toBe(201);
    expect(reset.body.mustChangePassword).toBe(true);

    expect((await http().get('/auth/me').set('Authorization', `Bearer ${working}`)).status).toBe(401);
    expect((await recharge(working)).status).toBe(401);
    expect((await recharge(miniBefore)).status).toBe(401);

    const again = await passwordLogin('Reset12345');
    expect(again.status).toBe(201);
    expect(again.body.mustChangePassword).toBe(true);
    const pending = again.body.accessToken as string;
    expectMustChange(await recharge(pending));
    expectMustChange(await reverse(pending, (await prisma.ledgerEntry.findFirstOrThrow({ where: { memberId } })).id));

    // 员工小程序重新用微信手机号登录就能继续干活，不用先去网页改密。
    const miniAgain = await http().post('/auth/staff/wx-phone').send({ code: 'manager', phoneCode: 'phone', orgId });
    expect(miniAgain.status).toBe(201);
    expect((await recharge(miniAgain.body.accessToken as string)).status).toBe(201);
  });

  it('leaves members alone', async () => {
    const me = await http().get('/members/me').set('Authorization', `Bearer ${memberToken}`);
    expect(me.status).toBe(200);
    const wallet = await http().get('/members/me/wallet').set('Authorization', `Bearer ${memberToken}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balanceCent).toBe(await balance());
  });

  it('rejects a staff token issued before this change (no login version in it)', async () => {
    const legacy = app.get(JwtService).sign({
      sub: managerId,
      orgId,
      principalType: 'STAFF',
      roles: [{ storeId: storeA, role: 'STORE_MANAGER' }],
    });
    const response = await http().get('/auth/me').set('Authorization', `Bearer ${legacy}`);
    expect(response.status).toBe(401);
  });
});
