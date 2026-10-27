import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomInt } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

class FakeWechat {
  readonly byCode = new Map<string, { phone: string; openId: string; unionId: string | null; countryCode: string }>();

  exchange(input: { code: string }) {
    const found = this.byCode.get(input.code);
    if (!found) {
      return Promise.reject(new UnauthorizedException('微信登录失败'));
    }
    return Promise.resolve(found);
  }

  bind(code: string, phone: string): void {
    this.byCode.set(code, {
      phone,
      openId: `openid-${phone}`,
      unionId: null,
      countryCode: '86',
    });
  }
}

function phone(): string {
  return `13${randomInt(100000000, 1000000000).toString()}`;
}

const initialPassword = 'Init12345';

function messageOf(body: { message?: unknown }): string {
  return typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
}

function payloadOf(token: string): { principalType?: string; roles?: { storeId: string; role: string }[] } {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as {
    principalType?: string;
    roles?: { storeId: string; role: string }[];
  };
}

describe('M1 auth and store boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let superId = '';
  let managerId = '';
  let clerkId = '';
  let outsiderId = '';
  let superToken = '';
  let managerToken = '';
  let clerkToken = '';
  let memberToken = '';
  let memberId = '';

  const phones = {
    super: phone(),
    manager: phone(),
    clerk: phone(),
    outsider: phone(),
    member: phone(),
  };

  async function cleanup(): Promise<void> {
    if (!orgId) {
      return;
    }
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.staffStoreRole.deleteMany({ where: { staff: { orgId } } });
    await prisma.staff.deleteMany({ where: { orgId } });
    await prisma.ledgerEntry.deleteMany({ where: { orgId } });
    await prisma.wallet.deleteMany({ where: { member: { orgId } } });
    await prisma.member.deleteMany({ where: { orgId } });
    await prisma.store.deleteMany({ where: { orgId } });
    await prisma.org.deleteMany({ where: { id: orgId } });
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
    await prisma.$queryRaw`SELECT 1`;

    const org = await prisma.org.create({ data: { name: `测试组织${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    const createdA = await prisma.store.create({
      data: { orgId, name: '旗舰店', status: 'ACTIVE', address: '甲路 1 号' },
    });
    const createdB = await prisma.store.create({
      data: { orgId, name: '社区店', status: 'ACTIVE' },
    });
    storeA = createdA.id;
    storeB = createdB.id;

    const superStaff = await prisma.staff.create({
      data: { orgId, phone: phones.super, name: '超级管理员', status: 'ACTIVE' },
    });
    const manager = await prisma.staff.create({
      data: { orgId, phone: phones.manager, name: '张店长', status: 'ACTIVE' },
    });
    const clerk = await prisma.staff.create({
      data: { orgId, phone: phones.clerk, name: '李店员', status: 'ACTIVE' },
    });
    const outsider = await prisma.staff.create({
      data: { orgId, phone: phones.outsider, name: '社区店员', status: 'ACTIVE' },
    });
    superId = superStaff.id;
    managerId = manager.id;
    clerkId = clerk.id;
    outsiderId = outsider.id;
    await prisma.staffStoreRole.createMany({
      data: [
        { staffId: superId, storeId: storeA, role: StaffRole.SUPER_ADMIN },
        { staffId: managerId, storeId: storeA, role: StaffRole.STORE_MANAGER },
        { staffId: clerkId, storeId: storeA, role: StaffRole.STAFF },
        { staffId: outsiderId, storeId: storeB, role: StaffRole.STAFF },
      ],
    });

    wechat.bind('super', phones.super);
    wechat.bind('manager', phones.manager);
    wechat.bind('clerk', phones.clerk);
    wechat.bind('outsider', phones.outsider);
    wechat.bind('member', phones.member);

    superToken = await login('/auth/staff/wx-phone', 'super');
    managerToken = await login('/auth/staff/wx-phone', 'manager');
    clerkToken = await login('/auth/staff/wx-phone', 'clerk');
    const memberResponse = await request(app.getHttpServer())
      .post('/auth/member/wx-phone')
      .send({ code: 'member', phoneCode: 'phone', orgId });
    expect(memberResponse.status).toBe(201);
    memberToken = memberResponse.body.accessToken as string;
    memberId = memberResponse.body.member.id as string;
  });

  afterAll(async () => {
    if (prisma && orgId) {
      await cleanup();
    }
    if (app) {
      await app.close();
    }
  });

  async function login(path: string, code: string): Promise<string> {
    const response = await request(app.getHttpServer()).post(path).send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  it('keeps health public and production signing off', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, esignProductionEnabled: false, db: 'up' });
  });

  it('rejects a staff phone that was never registered', async () => {
    wechat.bind('unknown', phone());
    const response = await request(app.getHttpServer())
      .post('/auth/staff/wx-phone')
      .send({ code: 'unknown', phoneCode: 'phone', orgId });
    expect(response.status).toBe(401);
    expect(messageOf(response.body)).toContain('账号未开通');
  });

  it('returns a staff login with roles and a member session that still needs a card', async () => {
    expect(payloadOf(superToken)).toMatchObject({
      principalType: 'STAFF',
      roles: [{ storeId: storeA, role: 'SUPER_ADMIN' }],
    });
    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${superToken}`);
    expect(me.status).toBe(200);
    expect(me.body.principalType).toBe('STAFF');
    expect(me.body.staff.id).toBe(superId);

    const memberMe = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberMe.status).toBe(200);
    expect(memberMe.body).toMatchObject({ principalType: 'MEMBER', needsCard: true });
    expect(memberMe.body.member).not.toHaveProperty('balanceCent');
    expect(payloadOf(memberToken).principalType).toBe('MEMBER');
    expect(await prisma.wallet.count({ where: { memberId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { memberId } })).toBe(0);
    const created = await prisma.auditLog.findFirst({
      where: { orgId, action: 'MEMBER_IDENTITY_CREATE', targetId: memberId },
    });
    expect(created).not.toBeNull();
  });

  it('refuses a member token on staff routes and a staff token on the member route', async () => {
    const stores = await request(app.getHttpServer())
      .get('/stores')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(stores.status).toBe(403);
    expect(messageOf(stores.body)).toContain('无权访问');
    const staff = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(staff.status).toBe(403);
    const member = await request(app.getHttpServer())
      .get('/members/me')
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(member.status).toBe(403);
    const missing = await request(app.getHttpServer()).get('/stores');
    expect(missing.status).toBe(401);
  });

  it('lets the member read only their own profile', async () => {
    const response = await request(app.getHttpServer())
      .get('/members/me')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: memberId, needsCard: true, openStoreId: null });
    expect(response.body).not.toHaveProperty('balanceCent');
  });

  it('lets a super admin create a store and writes an audit record', async () => {
    const response = await request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: '新建门店', address: '乙路 2 号' });
    expect(response.status).toBe(201);
    expect(response.body.name).toBe('新建门店');
    const log = await prisma.auditLog.findFirst({
      where: { orgId, action: 'STORE_CREATE', targetId: response.body.id as string },
    });
    expect(log?.actorStaffId).toBe(superId);
  });

  it('shows a manager only their store and rejects the other store', async () => {
    const list = await request(app.getHttpServer())
      .get('/stores')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([storeA]);

    const other = await request(app.getHttpServer())
      .get(`/stores/${storeB}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(other.status).toBe(403);
    expect(messageOf(other.body)).toContain('无权操作该门店');

    const patchOther = await request(app.getHttpServer())
      .patch(`/stores/${storeB}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '越权改名' });
    expect(patchOther.status).toBe(403);

    const create = await request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '店长私自建店' });
    expect(create.status).toBe(403);

    const status = await request(app.getHttpServer())
      .patch(`/stores/${storeA}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'DISABLED' });
    expect(status.status).toBe(403);
    expect(messageOf(status.body)).toContain('无权修改门店状态');

    const rename = await request(app.getHttpServer())
      .patch(`/stores/${storeA}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '旗舰店（已改）' });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe('旗舰店（已改）');
  });

  it('stops a clerk from managing stores or staff, while still allowing their own store', async () => {
    const create = await request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${clerkToken}`)
      .send({ name: '店员建店' });
    expect(create.status).toBe(403);

    const staff = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(staff.status).toBe(403);

    const own = await request(app.getHttpServer())
      .get(`/stores/${storeA}`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(own.status).toBe(200);
    const other = await request(app.getHttpServer())
      .get(`/stores/${storeB}`)
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(other.status).toBe(403);

    const mine = await request(app.getHttpServer())
      .get('/staff/me/stores')
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.unrestricted).toBe(false);
    expect(mine.body.stores.map((item: { id: string }) => item.id)).toEqual([storeA]);
  });

  it('lets a super admin see every store and assign manager or clerk roles', async () => {
    const mine = await request(app.getHttpServer())
      .get('/staff/me/stores')
      .set('Authorization', `Bearer ${superToken}`);
    expect(mine.body.unrestricted).toBe(true);
    const ids = mine.body.stores.map((item: { id: string }) => item.id) as string[];
    expect(ids).toEqual(expect.arrayContaining([storeA, storeB]));

    const created = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: phone(), name: '新店长', storeId: storeB, role: 'STORE_MANAGER', password: initialPassword });
    expect(created.status).toBe(201);
    expect(created.body.roles).toEqual([
      expect.objectContaining({ storeId: storeB, role: 'STORE_MANAGER' }),
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: { orgId, action: 'STAFF_CREATE', targetId: created.body.id as string },
    });
    expect(audit?.actorStaffId).toBe(superId);
  });

  it('limits a manager to their own clerks and blocks super-admin assignment', async () => {
    const list = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(list.status).toBe(200);
    const ids = list.body.items.map((item: { id: string }) => item.id) as string[];
    expect(ids).toContain(clerkId);
    expect(ids).not.toContain(outsiderId);

    const cross = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ phone: phone(), name: '越权员工', storeId: storeB, role: 'STAFF', password: initialPassword });
    expect(cross.status).toBe(403);

    const promote = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ phone: phone(), name: '越权店长', storeId: storeA, role: 'STORE_MANAGER', password: initialPassword });
    expect(promote.status).toBe(403);
    expect(messageOf(promote.body)).toContain('店长只能新建普通店员');

    const hired = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ phone: phone(), name: '本店新店员', storeId: storeA, role: 'STAFF', password: initialPassword });
    expect(hired.status).toBe(201);

    const grant = await request(app.getHttpServer())
      .put(`/staff/${clerkId}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [{ storeId: storeA, role: 'SUPER_ADMIN' }] });
    expect(grant.status).toBe(403);
    expect(messageOf(grant.body)).toContain('不可分配超级管理员');

    const touchSuper = await request(app.getHttpServer())
      .patch(`/staff/${superId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '改掉超管' });
    expect(touchSuper.status).toBe(403);
  });

  it('stops using a token after the account is disabled', async () => {
    const hiredPhone = phone();
    wechat.bind('soon-disabled', hiredPhone);
    const hired = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: hiredPhone, name: '即将停用', storeId: storeA, role: 'STAFF', password: initialPassword });
    expect(hired.status).toBe(201);
    const token = await login('/auth/staff/wx-phone', 'soon-disabled');
    const disabled = await request(app.getHttpServer())
      .patch(`/staff/${hired.body.id as string}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);
    const again = await request(app.getHttpServer()).get('/stores').set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(401);
    expect(messageOf(again.body)).toContain('登录已失效');
  });

  it('uses the database role after a demotion, not the old token claim', async () => {
    const hiredPhone = phone();
    wechat.bind('soon-demoted', hiredPhone);
    const hired = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: hiredPhone, name: '即将降级', storeId: storeA, role: 'STORE_MANAGER', password: initialPassword });
    expect(hired.status).toBe(201);
    const token = await login('/auth/staff/wx-phone', 'soon-demoted');
    expect(payloadOf(token).roles).toEqual([expect.objectContaining({ role: 'STORE_MANAGER' })]);
    const replaced = await request(app.getHttpServer())
      .put(`/staff/${hired.body.id as string}/roles`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ roles: [{ storeId: storeA, role: 'STAFF' }] });
    expect(replaced.status).toBe(200);
    const create = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: phone(), name: '降级后还想建人', storeId: storeA, role: 'STAFF', password: initialPassword });
    expect(create.status).toBe(403);
    const own = await request(app.getHttpServer())
      .get(`/stores/${storeA}`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    const log = await prisma.auditLog.findFirst({
      where: { orgId, action: 'STAFF_ROLES_REPLACE', targetId: hired.body.id as string },
    });
    expect(log?.actorStaffId).toBe(superId);
  });

  it('stops a manager from promoting a clerk or changing another manager', async () => {
    const promote = await request(app.getHttpServer())
      .put(`/staff/${clerkId}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [{ storeId: storeA, role: 'STORE_MANAGER' }] });
    expect(promote.status).toBe(403);
    expect(messageOf(promote.body)).toContain('店长只能分配普通店员');

    const kept = await request(app.getHttpServer())
      .put(`/staff/${clerkId}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [{ storeId: storeA, role: 'STAFF' }] });
    expect(kept.status).toBe(200);
    expect(kept.body.roles).toEqual([expect.objectContaining({ storeId: storeA, role: 'STAFF' })]);

    const self = await request(app.getHttpServer())
      .put(`/staff/${managerId}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [{ storeId: storeA, role: 'STAFF' }] });
    expect(self.status).toBe(403);
    expect(messageOf(self.body)).toContain('不能修改自己的角色');

    const peerPhone = phone();
    const peer = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: peerPhone, name: '王店长', storeId: storeA, role: 'STORE_MANAGER', password: initialPassword });
    expect(peer.status).toBe(201);
    const revoke = await request(app.getHttpServer())
      .put(`/staff/${peer.body.id as string}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [] });
    expect(revoke.status).toBe(403);
    expect(messageOf(revoke.body)).toContain('不能修改店长的角色');
    const demote = await request(app.getHttpServer())
      .put(`/staff/${peer.body.id as string}/roles`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: [{ storeId: storeA, role: 'STAFF' }] });
    expect(demote.status).toBe(403);
    expect(messageOf(demote.body)).toContain('不能修改店长的角色');

    const rename = await request(app.getHttpServer())
      .patch(`/staff/${peer.body.id as string}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '改掉店长' });
    expect(rename.status).toBe(403);
    expect(messageOf(rename.body)).toContain('不能修改店长');

    const still = await prisma.staffStoreRole.findMany({ where: { staffId: peer.body.id as string } });
    expect(still).toEqual([expect.objectContaining({ storeId: storeA, role: 'STORE_MANAGER' })]);
  });

  it('lets a member read usable stores and keeps staff routes closed', async () => {
    const placed = await request(app.getHttpServer())
      .patch(`/stores/${storeA}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        address: '示范路 18 号',
        lat: 31.230416,
        lng: 121.473701,
        phone: '021-12345678',
        businessHours: '每天 10:00-22:00',
      });
    expect(placed.status).toBe(200);
    expect(placed.body).toMatchObject({
      address: '示范路 18 号',
      phone: '021-12345678',
      businessHours: '每天 10:00-22:00',
    });
    expect(placed.body.lat).toBeCloseTo(31.230416, 5);
    expect(placed.body.lng).toBeCloseTo(121.473701, 5);

    const closed = await request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ name: '暂停门店', address: '不对外', phone: '021-00000000', businessHours: '暂停' });
    expect(closed.status).toBe(201);
    const disabled = await request(app.getHttpServer())
      .patch(`/stores/${closed.body.id as string}`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);

    const list = await request(app.getHttpServer())
      .get('/members/stores')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(list.status).toBe(200);
    const ids = list.body.map((item: { id: string }) => item.id) as string[];
    expect(ids).toContain(storeA);
    expect(ids).not.toContain(closed.body.id);
    const flagship = list.body.find((item: { id: string }) => item.id === storeA);
    expect(Object.keys(flagship).sort()).toEqual(
      ['address', 'businessHours', 'id', 'lat', 'lng', 'name', 'phone'].sort(),
    );
    expect(flagship).toMatchObject({
      name: placed.body.name,
      address: '示范路 18 号',
      phone: '021-12345678',
      businessHours: '每天 10:00-22:00',
    });
    expect(flagship.lat).toBeCloseTo(31.230416, 5);

    const staffOnMember = await request(app.getHttpServer())
      .get('/members/stores')
      .set('Authorization', `Bearer ${clerkToken}`);
    expect(staffOnMember.status).toBe(403);
    const memberOnStaff = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberOnStaff.status).toBe(403);
  });

  it('logs staff in with a password, locks after five failures, and requires a new password', async () => {
    const hiredPhone = phone();
    const hired = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ phone: hiredPhone, name: '网页店员', storeId: storeA, role: 'STAFF', password: initialPassword });
    expect(hired.status).toBe(201);
    expect(hired.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(hired.body)).not.toContain('passwordHash');
    expect(JSON.stringify(hired.body)).not.toContain('$2');

    const unknown = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: phone(), password: initialPassword, orgId });
    expect(unknown.status).toBe(401);
    expect(messageOf(unknown.body)).toContain('手机号或密码错误');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wrong = await request(app.getHttpServer())
        .post('/auth/staff/password/login')
        .send({ phone: hiredPhone, password: 'wrong-pass', orgId });
      expect(wrong.status).toBe(401);
      expect(messageOf(wrong.body)).toContain('手机号或密码错误');
    }
    const fifth = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: 'wrong-pass', orgId });
    expect(fifth.status).toBe(403);
    expect(messageOf(fifth.body)).toContain('登录已锁定');

    const duringLock = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: initialPassword, orgId });
    expect(duringLock.status).toBe(403);
    expect(messageOf(duringLock.body)).toContain('登录已锁定');

    await prisma.staff.update({
      where: { id: hired.body.id as string },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const unlocked = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: initialPassword, orgId });
    expect(unlocked.status).toBe(201);
    expect(unlocked.body.mustChangePassword).toBe(true);
    expect(unlocked.body.principalType).toBe('STAFF');
    expect(JSON.stringify(unlocked.body)).not.toContain('passwordHash');
    const webToken = unlocked.body.accessToken as string;

    const same = await request(app.getHttpServer())
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${webToken}`)
      .send({ currentPassword: initialPassword, newPassword: initialPassword });
    expect(same.status).toBe(400);

    const changed = await request(app.getHttpServer())
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${webToken}`)
      .send({ currentPassword: initialPassword, newPassword: 'Changed123' });
    expect(changed.status).toBe(201);
    expect(changed.body).toEqual({ mustChangePassword: false });
    const changedLog = await prisma.auditLog.findFirst({
      where: { orgId, action: 'STAFF_PASSWORD_CHANGE', targetId: hired.body.id as string },
    });
    expect(changedLog?.actorStaffId).toBe(hired.body.id);
    expect(JSON.stringify(changedLog?.payloadJson ?? {})).not.toContain('Changed123');

    const again = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: 'Changed123', orgId });
    expect(again.status).toBe(201);
    expect(again.body.mustChangePassword).toBe(false);

    const memberChange = await request(app.getHttpServer())
      .post('/auth/staff/password/change')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ currentPassword: initialPassword, newPassword: 'Changed123' });
    expect(memberChange.status).toBe(403);

    const managerReset = await request(app.getHttpServer())
      .post(`/staff/${hired.body.id as string}/password/reset`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ password: 'Reset12345' });
    expect(managerReset.status).toBe(403);

    const reset = await request(app.getHttpServer())
      .post(`/staff/${hired.body.id as string}/password/reset`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ password: 'Reset12345' });
    expect(reset.status).toBe(201);
    expect(reset.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(reset.body)).not.toContain('Reset12345');
    const old = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: 'Changed123', orgId });
    expect(old.status).toBe(401);
    const fresh = await request(app.getHttpServer())
      .post('/auth/staff/password/login')
      .send({ phone: hiredPhone, password: 'Reset12345', orgId });
    expect(fresh.status).toBe(201);
    expect(fresh.body.mustChangePassword).toBe(true);

    wechat.bind('web-clerk', hiredPhone);
    const mini = await request(app.getHttpServer())
      .post('/auth/staff/wx-phone')
      .send({ code: 'web-clerk', phoneCode: 'phone', orgId });
    expect(mini.status).toBe(201);
    expect(mini.body.principalType).toBe('STAFF');
  });
});
