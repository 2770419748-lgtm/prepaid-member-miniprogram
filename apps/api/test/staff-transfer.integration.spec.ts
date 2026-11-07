import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

class FakeWechat {
  readonly byCode = new Map<string, { phone: string; openId: string; unionId: string | null; countryCode: string }>();

  exchange(input: { code: string }) {
    const found = this.byCode.get(input.code);
    return found ? Promise.resolve(found) : Promise.reject(new UnauthorizedException('微信登录失败'));
  }

  bind(code: string, phone: string): void {
    this.byCode.set(code, { phone, openId: `openid-${phone}`, unionId: null, countryCode: '86' });
  }
}

function phone(): string {
  return `13${randomInt(100000000, 1000000000).toString()}`;
}

function messageOf(body: { message?: unknown }): string {
  return typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
}

interface AuditItem {
  action: string;
  targetId: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * 调店（换门店）：只有超级管理员能把人调去别的门店；店长只能动本店的店员；一家门店都不剩自动停用；
 * 调动在操作记录里写清原来和现在，两边店长都看得到；公司至少留一位在职超级管理员。
 * 操作记录和流水只能追加，所以每个用例自己建一个新公司，不清理数据。
 */
describe('Staff store transfer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  const http = () => request(app.getHttpServer());

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
  });

  afterAll(async () => {
    await app?.close();
  });

  type Key = 'super' | 'managerA' | 'managerB' | 'clerkA' | 'clerkB' | 'clerkAB';

  /** 一家公司两家店：A 店长、B 店长、A 店员、B 店员、两家店都在的店员，加一位超级管理员。 */
  async function company() {
    const org = await prisma.org.create({ data: { name: `调店测试${Date.now()}${randomInt(1000)}`, status: 'ACTIVE' } });
    const orgId = org.id;
    const storeA = (await prisma.store.create({ data: { orgId, name: '旗舰店', status: 'ACTIVE' } })).id;
    const storeB = (await prisma.store.create({ data: { orgId, name: '内江店', status: 'ACTIVE' } })).id;
    const plan: [Key, [string, StaffRole][]][] = [
      ['super', [[storeA, StaffRole.SUPER_ADMIN]]],
      ['managerA', [[storeA, StaffRole.STORE_MANAGER]]],
      ['managerB', [[storeB, StaffRole.STORE_MANAGER]]],
      ['clerkA', [[storeA, StaffRole.STAFF]]],
      ['clerkB', [[storeB, StaffRole.STAFF]]],
      [
        'clerkAB',
        [
          [storeA, StaffRole.STAFF],
          [storeB, StaffRole.STAFF],
        ],
      ],
    ];
    const ids = {} as Record<Key, string>;
    const tokens = {} as Record<Key, string>;
    const codes = {} as Record<Key, string>;
    for (const [key, roles] of plan) {
      const p = phone();
      const staff = await prisma.staff.create({ data: { orgId, phone: p, name: key, status: 'ACTIVE' } });
      ids[key] = staff.id;
      await prisma.staffStoreRole.createMany({
        data: roles.map(([storeId, role]) => ({ staffId: staff.id, storeId, role })),
      });
      codes[key] = `${key}-${p}`;
      wechat.bind(codes[key], p);
      const login = await http().post('/auth/staff/wx-phone').send({ code: codes[key], phoneCode: 'x', orgId });
      expect(login.status).toBe(201);
      tokens[key] = login.body.accessToken as string;
    }
    return { orgId, storeA, storeB, ids, tokens, codes };
  }

  function putRoles(token: string, staffId: string, roles: { storeId: string; role: string }[]) {
    return http().put(`/staff/${staffId}/roles`).set('Authorization', `Bearer ${token}`).send({ roles });
  }

  async function storeRoles(staffId: string) {
    const rows = await prisma.staffStoreRole.findMany({ where: { staffId } });
    return rows.map((row) => ({ storeId: row.storeId, role: row.role })).sort((a, b) => a.storeId.localeCompare(b.storeId));
  }

  async function auditFor(token: string, query: Record<string, string>): Promise<AuditItem[]> {
    const response = await http().get('/audit-logs').query(query).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response.body.items as AuditItem[];
  }

  it('stops a manager from pulling another store’s clerk into their store', async () => {
    const c = await company();
    const grab = await putRoles(c.tokens.managerA, c.ids.clerkB, [{ storeId: c.storeA, role: 'STAFF' }]);
    expect(grab.status).toBe(403);
    expect(messageOf(grab.body)).toContain('这位员工不在你管的门店，调店请找超级管理员');
    expect(await storeRoles(c.ids.clerkB)).toEqual([{ storeId: c.storeB, role: 'STAFF' }]);
    // 也不能对别家店的人「移除」，留下一条什么都没改的记录。
    const empty = await putRoles(c.tokens.managerA, c.ids.clerkB, []);
    expect(empty.status).toBe(403);
    const logs = await prisma.auditLog.count({
      where: { orgId: c.orgId, action: 'STAFF_ROLES_REPLACE', targetId: c.ids.clerkB },
    });
    expect(logs).toBe(0);
    // 不能把本店店员推去别家店。
    const push = await putRoles(c.tokens.managerA, c.ids.clerkA, [{ storeId: c.storeB, role: 'STAFF' }]);
    expect(push.status).toBe(403);
    expect(messageOf(push.body)).toContain('无权操作该门店');
    // 两家店都在的店员，A 店长可以照常调整他在 A 店的角色，B 店的不动。
    const kept = await putRoles(c.tokens.managerA, c.ids.clerkAB, [{ storeId: c.storeA, role: 'STAFF' }]);
    expect(kept.status).toBe(200);
    expect(await storeRoles(c.ids.clerkAB)).toHaveLength(2);
  });

  it('moves a clerk to another store right away, keeps old entries at the old store, and logs from → to for both managers', async () => {
    const c = await company();
    // 调店前 A 店长在 A 店记一笔，操作人记成 A 店长。
    const card = await http()
      .post('/members/open')
      .set('Authorization', `Bearer ${c.tokens.managerA}`)
      .send({ phone: phone(), storeId: c.storeA });
    expect(card.status).toBe(201);
    const recharge = await http()
      .post(`/wallets/${card.body.id as string}/recharge`)
      .set('Authorization', `Bearer ${c.tokens.managerA}`)
      .send({ storeId: c.storeA, amountCent: 10_000, requestId: randomUUID() });
    expect(recharge.status).toBe(201);
    const entryId = recharge.body.entry.id as string;

    const moved = await putRoles(c.tokens.super, c.ids.managerA, [{ storeId: c.storeB, role: 'STORE_MANAGER' }]);
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('ACTIVE');

    // 不用重新登录，旧凭证马上只认新门店。
    const mine = await http().get('/staff/me/stores').set('Authorization', `Bearer ${c.tokens.managerA}`);
    expect(mine.body.stores.map((s: { id: string; role: string }) => [s.id, s.role])).toEqual([
      [c.storeB, 'STORE_MANAGER'],
    ]);
    const oldLedger = await http().get(`/ledger/${entryId}`).set('Authorization', `Bearer ${c.tokens.managerA}`);
    expect(oldLedger.status).toBe(403);
    const reverse = await http()
      .post(`/ledger/${entryId}/reversal`)
      .set('Authorization', `Bearer ${c.tokens.managerA}`)
      .send({ remark: '调走后想撤销', requestId: randomUUID() });
    expect(reverse.status).toBe(403);
    // 那笔账还在 A 店名下，操作人不变。
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry).toMatchObject({ storeId: c.storeA, operatorStaffId: c.ids.managerA });

    // 再把 A 店员调去 B 店：A、B 两家店长都能在操作记录里看到，写清原来和现在。
    const clerkMoved = await putRoles(c.tokens.super, c.ids.clerkA, [{ storeId: c.storeB, role: 'STAFF' }]);
    expect(clerkMoved.status).toBe(200);
    const expected = {
      previousRoles: [{ storeId: c.storeA, storeName: '旗舰店', role: 'STAFF' }],
      roles: [{ storeId: c.storeB, storeName: '内江店', role: 'STAFF' }],
    };
    const fromB = await auditFor(c.tokens.managerB, { action: 'STAFF_ROLES_REPLACE' });
    expect(fromB.find((item) => item.targetId === c.ids.clerkA)?.payload).toEqual(expected);
    const filteredByA = await auditFor(c.tokens.super, { action: 'STAFF_ROLES_REPLACE', storeId: c.storeA });
    expect(filteredByA.map((item) => item.targetId)).toEqual(expect.arrayContaining([c.ids.clerkA, c.ids.managerA]));

    // 新的 A 店长（超管任命）能看到调出记录，也能处理原来记在 A 店的账。
    const newManagerPhone = phone();
    const hired = await http()
      .post('/staff')
      .set('Authorization', `Bearer ${c.tokens.super}`)
      .send({ phone: newManagerPhone, name: '新店长', storeId: c.storeA, role: 'STORE_MANAGER', password: 'Init12345' });
    expect(hired.status).toBe(201);
    wechat.bind('new-manager', newManagerPhone);
    const newLogin = await http().post('/auth/staff/wx-phone').send({ code: 'new-manager', phoneCode: 'x', orgId: c.orgId });
    const newToken = newLogin.body.accessToken as string;
    const fromNewA = await auditFor(newToken, { action: 'STAFF_ROLES_REPLACE' });
    expect(fromNewA.map((item) => item.targetId)).toEqual(expect.arrayContaining([c.ids.clerkA, c.ids.managerA]));
    const newReverse = await http()
      .post(`/ledger/${entryId}/reversal`)
      .set('Authorization', `Bearer ${newToken}`)
      .send({ remark: '原店长调走了，新店长处理', requestId: randomUUID() });
    expect(newReverse.status).toBe(201);

    // 和这两家店都无关的店长看不到这条调动。
    const storeC = (await prisma.store.create({ data: { orgId: c.orgId, name: '第三家店', status: 'ACTIVE' } })).id;
    const otherPhone = phone();
    const other = await prisma.staff.create({ data: { orgId: c.orgId, phone: otherPhone, name: '别家店长', status: 'ACTIVE' } });
    await prisma.staffStoreRole.create({ data: { staffId: other.id, storeId: storeC, role: StaffRole.STORE_MANAGER } });
    wechat.bind('other-manager', otherPhone);
    const otherLogin = await http().post('/auth/staff/wx-phone').send({ code: 'other-manager', phoneCode: 'x', orgId: c.orgId });
    const fromC = await auditFor(otherLogin.body.accessToken as string, { action: 'STAFF_ROLES_REPLACE' });
    expect(fromC).toEqual([]);
  });

  it('disables a clerk who is left with no store, and only restores after a store is assigned', async () => {
    const c = await company();
    // 两家店都在的店员，A 店长把他移出 A 店：还在 B 店，照常在职。
    const partly = await putRoles(c.tokens.managerA, c.ids.clerkAB, []);
    expect(partly.status).toBe(200);
    const stillActive = await prisma.staff.findUniqueOrThrow({ where: { id: c.ids.clerkAB } });
    expect(stillActive.status).toBe('ACTIVE');
    expect(await storeRoles(c.ids.clerkAB)).toEqual([{ storeId: c.storeB, role: 'STAFF' }]);

    // 只在 A 店的店员被移出 A 店：一家都不剩，账号自动停用，旧登录马上失效。
    const removed = await putRoles(c.tokens.managerA, c.ids.clerkA, []);
    expect(removed.status).toBe(200);
    expect(removed.body.status).toBe('DISABLED');
    const after = await http().get('/staff/me/stores').set('Authorization', `Bearer ${c.tokens.clerkA}`);
    expect(after.status).toBe(401);
    // 再用微信手机号登录就只是会员了。
    const relogin = await http().post('/auth/wx-phone').send({ code: c.codes.clerkA, phoneCode: 'x', orgId: c.orgId });
    expect(relogin.status).toBe(201);
    expect(relogin.body.principalType).toBe('MEMBER');
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { orgId: c.orgId, action: 'STAFF_ROLES_REPLACE', targetId: c.ids.clerkA },
    });
    expect(log.payloadJson).toEqual({
      previousRoles: [{ storeId: c.storeA, storeName: '旗舰店', role: 'STAFF' }],
      roles: [],
      autoDisabled: true,
    });
    expect(log.relatedStoreIds).toEqual([c.storeA]);

    // 没门店不能直接恢复；超管先分配门店再恢复就行。
    const restore = await http()
      .patch(`/staff/${c.ids.clerkA}`)
      .set('Authorization', `Bearer ${c.tokens.super}`)
      .send({ status: 'ACTIVE' });
    expect(restore.status).toBe(400);
    expect(messageOf(restore.body)).toContain('请先在「门店角色」里分配门店再恢复');
    const assigned = await putRoles(c.tokens.super, c.ids.clerkA, [{ storeId: c.storeB, role: 'STAFF' }]);
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('DISABLED');
    const restored = await http()
      .patch(`/staff/${c.ids.clerkA}`)
      .set('Authorization', `Bearer ${c.tokens.super}`)
      .send({ status: 'ACTIVE' });
    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe('ACTIVE');
    // B 店长在操作记录里能看到这位员工的恢复。
    const fromB = await auditFor(c.tokens.managerB, { action: 'STAFF_UPDATE' });
    expect(fromB.map((item) => item.targetId)).toContain(c.ids.clerkA);
  });

  it('keeps at least one active super admin', async () => {
    const c = await company();
    const demote = await putRoles(c.tokens.super, c.ids.super, [{ storeId: c.storeA, role: 'STAFF' }]);
    expect(demote.status).toBe(409);
    expect(messageOf(demote.body)).toContain('公司至少要留一位在职的超级管理员');
    const removeAll = await putRoles(c.tokens.super, c.ids.super, []);
    expect(removeAll.status).toBe(409);
    const disable = await http()
      .patch(`/staff/${c.ids.super}`)
      .set('Authorization', `Bearer ${c.tokens.super}`)
      .send({ status: 'DISABLED' });
    expect(disable.status).toBe(409);
    const self = await prisma.staff.findUniqueOrThrow({ where: { id: c.ids.super }, include: { storeRoles: true } });
    expect(self.status).toBe('ACTIVE');
    expect(self.storeRoles.map((role) => role.role)).toEqual(['SUPER_ADMIN']);
    const logs = await prisma.auditLog.count({ where: { orgId: c.orgId, targetId: c.ids.super } });
    expect(logs).toBe(0);

    // 再任命一位超管后，可以把其中一位降级；两位同时互相降级，只有一个能成。
    const second = await putRoles(c.tokens.super, c.ids.managerB, [{ storeId: c.storeB, role: 'SUPER_ADMIN' }]);
    expect(second.status).toBe(200);
    const [first, other] = await Promise.all([
      putRoles(c.tokens.super, c.ids.managerB, [{ storeId: c.storeB, role: 'STORE_MANAGER' }]),
      putRoles(c.tokens.managerB, c.ids.super, [{ storeId: c.storeA, role: 'STORE_MANAGER' }]),
    ]);
    const statuses = [first.status, other.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const remaining = await prisma.staff.count({
      where: { orgId: c.orgId, status: 'ACTIVE', storeRoles: { some: { role: 'SUPER_ADMIN' } } },
    });
    expect(remaining).toBe(1);
  });
});
