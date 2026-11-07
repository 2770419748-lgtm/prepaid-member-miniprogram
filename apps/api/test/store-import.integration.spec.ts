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

interface ImportItem {
  index: number;
  name: string;
  action: string;
  storeId: string | null;
  storeDisabled: boolean;
  changes: string[];
  error: string | null;
}

/**
 * 用表格批量录门店：按名称对上的只补填了且不一样的项，对不上的新建；有一行不对整批不导；只有超级管理员能用。
 * 操作记录只能追加，所以每个用例自己建一个新公司，不清理数据。
 */
describe('Store import from a spreadsheet', () => {
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

  /** 一家公司：初始化时建的第一家店（只有名字）、一家已停用的店，超管和店长各一位。 */
  async function company() {
    const org = await prisma.org.create({ data: { name: `导入测试${Date.now()}${randomInt(1000)}`, status: 'ACTIVE' } });
    const orgId = org.id;
    const first = (await prisma.store.create({ data: { orgId, name: '成都蜀都万达店', status: 'ACTIVE' } })).id;
    const closed = (
      await prisma.store.create({
        data: { orgId, name: '德阳吾悦店', status: 'DISABLED', address: '德阳旧地址', contactPhone: '0838-1111111' },
      })
    ).id;
    const tokens = {} as Record<'super' | 'manager', string>;
    for (const [key, role] of [
      ['super', StaffRole.SUPER_ADMIN],
      ['manager', StaffRole.STORE_MANAGER],
    ] as const) {
      const p = phone();
      const staff = await prisma.staff.create({ data: { orgId, phone: p, name: key, status: 'ACTIVE' } });
      await prisma.staffStoreRole.create({ data: { staffId: staff.id, storeId: first, role } });
      wechat.bind(`${key}-${p}`, p);
      const login = await http().post('/auth/staff/wx-phone').send({ code: `${key}-${p}`, phoneCode: 'x', orgId });
      expect(login.status).toBe(201);
      tokens[key] = login.body.accessToken as string;
    }
    return { orgId, first, closed, tokens };
  }

  function importRows(token: string, dryRun: boolean, rows: Record<string, unknown>[]) {
    return http().post('/stores/import').set('Authorization', `Bearer ${token}`).send({ dryRun, rows });
  }

  const sheet = [
    {
      name: '成都蜀都万达店',
      address: '成都市锦江区示例路 1 号 3 楼',
      phone: '028-12345678',
      businessHours: '每天 10:00-22:00',
      lat: 30.65718,
      lng: 104.08081,
    },
    { name: '内江吾悦店', address: '内江市示例大道 8 号', phone: '13900000000', lat: 29.58015, lng: 105.06614 },
    { name: '  德阳吾悦店 ', phone: '0838-2222222' },
    { name: '遂宁万象汇店' },
  ];

  it('previews first, then fills in the existing store and creates the new ones', async () => {
    const c = await company();
    const before = await prisma.store.count({ where: { orgId: c.orgId } });

    const preview = await importRows(c.tokens.super, true, sheet);
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ dryRun: true, created: 2, updated: 2, unchanged: 0, errors: 0 });
    const items = preview.body.items as ImportItem[];
    expect(items.map((item) => item.action)).toEqual(['UPDATE', 'CREATE', 'UPDATE', 'CREATE']);
    expect(items[0]).toMatchObject({ storeId: c.first, changes: ['address', 'phone', 'businessHours', 'location'] });
    // 名字前后的空格不算，照样对上已停用的那家；只改电话，不改营业状态。
    expect(items[2]).toMatchObject({ name: '德阳吾悦店', storeId: c.closed, storeDisabled: true, changes: ['phone'] });
    // 只核对，不写库。
    expect(await prisma.store.count({ where: { orgId: c.orgId } })).toBe(before);

    const done = await importRows(c.tokens.super, false, sheet);
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ dryRun: false, created: 2, updated: 2, unchanged: 0, errors: 0 });
    const stores = await prisma.store.findMany({ where: { orgId: c.orgId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(stores.map((store) => store.name)).toEqual(['成都蜀都万达店', '德阳吾悦店', '内江吾悦店', '遂宁万象汇店']);
    const first = stores[0];
    expect(first).toMatchObject({
      address: '成都市锦江区示例路 1 号 3 楼',
      contactPhone: '028-12345678',
      businessHours: '每天 10:00-22:00',
      status: 'ACTIVE',
    });
    expect(first.lat?.toNumber()).toBe(30.65718);
    expect(first.lng?.toNumber()).toBe(104.08081);
    // 没填的项保持原样。
    expect(stores[1]).toMatchObject({ status: 'DISABLED', address: '德阳旧地址', contactPhone: '0838-2222222' });
    expect(stores[3]).toMatchObject({ status: 'ACTIVE', address: null, contactPhone: null, lat: null });

    // 每家新建、改动的门店一条操作记录，标明是表格导入。
    const logs = await prisma.auditLog.findMany({
      where: { orgId: c.orgId, action: { in: ['STORE_CREATE', 'STORE_UPDATE'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((log) => log.action).sort()).toEqual(['STORE_CREATE', 'STORE_CREATE', 'STORE_UPDATE', 'STORE_UPDATE']);
    for (const log of logs) {
      expect((log.payloadJson as Record<string, unknown>).source).toBe('import');
    }
    const closedLog = logs.find((log) => log.targetId === c.closed);
    expect(closedLog?.payloadJson).toEqual({ phone: '0838-2222222', source: 'import' });

    // 同一张表再导一次：什么都不变，也不多写操作记录。
    const again = await importRows(c.tokens.super, false, sheet);
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 4, errors: 0 });
    expect(await prisma.store.count({ where: { orgId: c.orgId } })).toBe(4);
    expect(
      await prisma.auditLog.count({ where: { orgId: c.orgId, action: { in: ['STORE_CREATE', 'STORE_UPDATE'] } } }),
    ).toBe(4);

    // 新门店照样出现在会员端的可用门店里。
    const list = await http().get('/stores').query({ pageSize: 100 }).set('Authorization', `Bearer ${c.tokens.super}`);
    expect((list.body.items as { name: string }[]).map((store) => store.name)).toContain('内江吾悦店');
  });

  it('refuses the whole sheet when one row is wrong', async () => {
    const c = await company();
    await prisma.store.create({ data: { orgId: c.orgId, name: '南充王府井店', status: 'ACTIVE' } });
    await prisma.store.create({ data: { orgId: c.orgId, name: '南充王府井店', status: 'DISABLED' } });
    const rows = [
      { name: '南充临江万达店', address: '南充市示例路 2 号' },
      { name: '南充临江万达店', address: '重复的一行' },
      { name: '南充王府井店' },
      { name: '南充仁和广场店', lat: 30.8 },
    ];
    const preview = await importRows(c.tokens.super, true, rows);
    expect(preview.status).toBe(201);
    expect(preview.body).toMatchObject({ created: 1, errors: 3 });
    const items = preview.body.items as ImportItem[];
    expect(items[1].error).toContain('同一家店只写一行');
    expect(items[2].error).toContain('后台有 2 家门店都叫「南充王府井店」');
    expect(items[3].error).toBe('纬度和经度要一起填');

    const done = await importRows(c.tokens.super, false, rows);
    expect(done.status).toBe(400);
    expect(messageOf(done.body)).toBe('表格里有 3 行要先改好，这次一家都没导入');
    expect(await prisma.store.count({ where: { orgId: c.orgId, name: '南充临江万达店' } })).toBe(0);
  });

  it('checks the rows and lets only a super admin import', async () => {
    const c = await company();
    const manager = await importRows(c.tokens.manager, true, [{ name: '店长想建的店' }]);
    expect(manager.status).toBe(403);
    const empty = await importRows(c.tokens.super, true, []);
    expect(empty.status).toBe(400);
    expect(messageOf(empty.body)).toContain('表格里没有门店');
    const tooLong = await importRows(c.tokens.super, true, [{ name: '店'.repeat(81) }]);
    expect(tooLong.status).toBe(400);
    const badLat = await importRows(c.tokens.super, true, [{ name: '坐标填反', lat: 104.08, lng: 30.65 }]);
    expect(badLat.status).toBe(400);
    const tooMany = await importRows(
      c.tokens.super,
      true,
      Array.from({ length: 201 }, (_, i) => ({ name: `门店${i}` })),
    );
    expect(tooMany.status).toBe(400);
    expect(messageOf(tooMany.body)).toContain('一次最多导入 200 家门店');
  });
});
