import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { signFlowRequestId } from '../src/wallet/wallet.service';
import { FakeWechat, messageOf, randomPhone } from './support/fake-wechat';

/** 一张「照片」：JPEG 文件头 + 随机内容，服务端只按文件头认类型。 */
function jpeg(size = 2048): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.write(randomUUID(), 8, 'latin1');
  return bytes;
}

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 开单改为上传纸质协议单（坤总 2026-11-05）：店员传照片 → 交单即已签署并充值 → 会员在小程序看照片。
 * 照片只有会员本人、开单门店的员工和超管能看；照错了超管或店长删除。电子签代码保留，开关关着时不能发起。
 * 流水和操作记录只追加，不清理，每次用新组织。
 */
describe('paper agreement: upload the signed paper form instead of e-signing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const wechat = new FakeWechat();
  const storageDir = mkdtempSync(join(tmpdir(), 'paper-agreement-storage-'));
  const savedEnv = { ...process.env };
  let orgId = '';
  let storeA = '';
  let storeB = '';
  let planId = '';
  let draftPlanId = '';
  const tokens = { super: '', managerA: '', clerkA: '', clerkA2: '', clerkB: '' };
  const phones = {
    super: randomPhone(),
    managerA: randomPhone(),
    clerkA: randomPhone(),
    clerkA2: randomPhone(),
    clerkB: randomPhone(),
  };

  function http() {
    return request(app.getHttpServer());
  }

  function as(token: string) {
    return {
      get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body?: object) =>
        http().post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
      upload: (bytes: Buffer, name = 'agreement.jpg') =>
        http().post('/sign-flows/photos').set('Authorization', `Bearer ${token}`).attach('file', bytes, name),
    };
  }

  async function staffLogin(code: string): Promise<string> {
    const response = await http().post('/auth/staff/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function memberLogin(phone: string): Promise<string> {
    const code = `member-${phone}-${randomUUID()}`;
    wechat.bind(code, phone);
    const response = await http().post('/auth/member/wx-phone').send({ code, phoneCode: 'phone', orgId });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function newCard(token = tokens.clerkA, storeId = storeA): Promise<{ id: string; phone: string }> {
    const phone = randomPhone();
    const opened = await as(token).post('/members/open', { phone, storeId });
    expect(opened.status).toBe(201);
    return { id: opened.body.id as string, phone };
  }

  async function photo(token = tokens.clerkA, bytes = jpeg()): Promise<string> {
    const uploaded = await as(token).upload(bytes);
    expect(uploaded.status).toBe(201);
    return uploaded.body.id as string;
  }

  async function paper(
    memberId: string,
    amountCent: number,
    options: { token?: string; storeId?: string; photoIds?: string[]; requestId?: string; benefitPlanId?: string } = {},
  ) {
    const token = options.token ?? tokens.clerkA;
    return as(token).post('/sign-flows/paper', {
      memberId,
      storeId: options.storeId ?? storeA,
      rechargeAmountCent: amountCent,
      photoIds: options.photoIds ?? [await photo(token)],
      requestId: options.requestId ?? randomUUID(),
      ...(options.benefitPlanId ? { benefitPlanId: options.benefitPlanId } : {}),
    });
  }

  async function balanceOf(memberId: string): Promise<number> {
    return (await prisma.wallet.findUniqueOrThrow({ where: { memberId } })).balanceCent;
  }

  beforeAll(async () => {
    process.env.WECHAT_MEMBER_APPID = 'test-member-app';
    process.env.WECHAT_MEMBER_SECRET = 'test-member-secret';
    process.env.WECHAT_PHONE_MOCK = 'false';
    process.env.ESIGN_PRODUCTION_ENABLED = 'false';
    delete process.env.SIGN_MODE;
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

    const org = await prisma.org.create({ data: { name: `纸质协议单测试${Date.now()}`, status: 'ACTIVE' } });
    orgId = org.id;
    storeA = (await prisma.store.create({ data: { orgId, name: '内江店', status: 'ACTIVE' } })).id;
    storeB = (await prisma.store.create({ data: { orgId, name: '成都店', status: 'ACTIVE' } })).id;
    const people: [keyof typeof tokens, string, StaffRole, string][] = [
      ['super', '超级管理员', StaffRole.SUPER_ADMIN, storeA],
      ['managerA', '陈店长', StaffRole.STORE_MANAGER, storeA],
      ['clerkA', '李晓', StaffRole.STAFF, storeA],
      ['clerkA2', '王店员', StaffRole.STAFF, storeA],
      ['clerkB', '成都店员', StaffRole.STAFF, storeB],
    ];
    for (const [key, name, role, storeId] of people) {
      await prisma.staff.create({
        data: { orgId, phone: phones[key], name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
      });
      wechat.bind(key, phones[key]);
      tokens[key] = await staffLogin(key);
    }
    const plan = await as(tokens.super).post('/benefit-plans', {
      title: 'SVIP 会员权益',
      items: [{ title: '配件 8.8 折' }, { title: '免费系统维护' }],
    });
    expect(plan.status).toBe(201);
    planId = plan.body.id as string;
    const draft = await as(tokens.super).post('/benefit-plans', {
      title: '还没上线的方案',
      items: [{ title: '草稿条目' }],
      status: 'DRAFT',
    });
    draftPlanId = draft.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
    rmSync(storageDir, { recursive: true, force: true });
    process.env = savedEnv;
  });

  it('opens orders with a paper agreement by default and no longer starts e-signing', async () => {
    const config = await as(tokens.clerkA).get('/sign-flows/config');
    expect(config.status).toBe(200);
    expect(config.body).toEqual({ mode: 'PAPER', maxPhotos: 9, maxPhotoBytes: 8 * 1024 * 1024 });

    const member = await newCard();
    const esign = await as(tokens.clerkA).post('/sign-flows', {
      memberId: member.id,
      templateId: 'any',
      storeId: storeA,
      rechargeAmountCent: 10000,
      requestId: randomUUID(),
    });
    expect(esign.status).toBe(400);
    expect(messageOf(esign.body)).toContain('不再发起电子签');
  });

  it('only takes real photos up to 8MB', async () => {
    const empty = await as(tokens.clerkA).upload(Buffer.alloc(0));
    expect(empty.status).toBe(400);
    const pdf = await as(tokens.clerkA).upload(Buffer.from('%PDF-1.4 not a photo'), 'agreement.jpg');
    expect(pdf.status).toBe(400);
    expect(messageOf(pdf.body)).toContain('JPG');
    const big = await as(tokens.clerkA).upload(jpeg(8 * 1024 * 1024 + 1));
    expect(big.status).toBe(400);
    expect(messageOf(big.body)).toContain('8MB');

    const png = await as(tokens.clerkA).upload(Buffer.concat([PNG_HEAD, Buffer.alloc(100)]), 'x.png');
    expect(png.status).toBe(201);
    expect(png.body).toMatchObject({ contentType: 'image/png', sizeBytes: 108 });
    const memberToken = await memberLogin(randomPhone());
    const asMember = await http()
      .post('/sign-flows/photos')
      .set('Authorization', `Bearer ${memberToken}`)
      .attach('file', jpeg(), 'a.jpg');
    expect(asMember.status).toBe(403);
  });

  it('uploading the agreement signs it and recharges the benefit amount at once', async () => {
    const member = await newCard();
    const photos = [await photo(), await photo()];
    const response = await paper(member.id, 100000, { photoIds: photos, benefitPlanId: planId });
    expect(response.status).toBe(201);
    const flow = response.body;
    expect(flow).toMatchObject({
      kind: 'PAPER',
      status: 'SIGNED',
      sandbox: false,
      title: 'SVIP 会员权益',
      template: null,
      benefitPlan: { id: planId, title: 'SVIP 会员权益' },
      store: { id: storeA, name: '内江店' },
      initiator: { name: '李晓' },
      rechargeAmountCent: 100000,
      rechargeReversed: false,
      hasPdf: false,
      signUrl: null,
    });
    expect(flow.rechargeEntryId).toEqual(expect.any(String));
    expect(flow.photos.map((p: { id: string }) => p.id)).toEqual(photos);
    expect(flow.signedAt).toEqual(expect.any(String));
    expect(await balanceOf(member.id)).toBe(100000);

    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: flow.rechargeEntryId } });
    expect(entry).toMatchObject({
      type: 'RECHARGE',
      amountCent: 100000,
      storeId: storeA,
      remark: '纸质协议单上传后充值',
      requestId: signFlowRequestId(flow.id),
    });
    const created = await prisma.auditLog.findFirstOrThrow({
      where: { orgId, action: 'PAPER_AGREEMENT_CREATE', targetId: flow.id },
    });
    expect(created.payloadJson).toMatchObject({
      memberId: member.id,
      benefitPlanId: planId,
      rechargeAmountCent: 100000,
      photoCount: 2,
    });
    const recharge = await prisma.auditLog.findFirstOrThrow({
      where: { orgId, action: 'WALLET_RECHARGE', targetId: flow.rechargeEntryId },
    });
    expect(recharge.payloadJson).toMatchObject({ signFlowId: flow.id });

    const listed = await as(tokens.clerkA).get(`/sign-flows?memberId=${member.id}`);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ id: flow.id, kind: 'PAPER' });
  });

  it('a retried submit opens one order and recharges once; a changed retry is refused', async () => {
    const member = await newCard();
    const requestId = randomUUID();
    const photoIds = [await photo()];
    const [first, second] = await Promise.all([
      paper(member.id, 50000, { photoIds, requestId }),
      paper(member.id, 50000, { photoIds, requestId }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await balanceOf(member.id)).toBe(50000);
    expect(await prisma.signFlow.count({ where: { memberId: member.id } })).toBe(1);

    const changed = await paper(member.id, 60000, { photoIds, requestId });
    expect(changed.status).toBe(409);
  });

  it('photos are used once and only by the staff who took them', async () => {
    const member = await newCard();
    const photoId = await photo();
    expect((await paper(member.id, 1000, { photoIds: [photoId] })).status).toBe(201);
    const reused = await paper(member.id, 1000, { photoIds: [photoId] });
    expect(reused.status).toBe(400);
    expect(messageOf(reused.body)).toContain('重新选择照片');

    const colleagues = await photo(tokens.clerkA2);
    const borrowed = await paper(member.id, 1000, { photoIds: [colleagues] });
    expect(borrowed.status).toBe(400);

    const old = await photo();
    await prisma.$executeRaw`UPDATE agreement_photos SET created_at = now() - interval '2 days' WHERE id = ${old}`;
    expect((await paper(member.id, 1000, { photoIds: [old] })).status).toBe(400);

    const noPhoto = await as(tokens.clerkA).post('/sign-flows/paper', {
      memberId: member.id,
      storeId: storeA,
      rechargeAmountCent: 1000,
      photoIds: [],
      requestId: randomUUID(),
    });
    expect(noPhoto.status).toBe(400);
  });

  it('checks the store, the card and the plan before taking the order', async () => {
    const memberToken = await memberLogin(randomPhone());
    const me = await as(memberToken).get('/members/me');
    const noCard = await paper(me.body.id as string, 1000);
    expect(noCard.status).toBe(400);
    expect(messageOf(noCard.body)).toContain('开卡');

    const member = await newCard();
    expect((await paper(member.id, 1000, { storeId: storeB })).status).toBe(403);
    expect((await paper(member.id, 1000, { benefitPlanId: draftPlanId })).status).toBe(400);
    expect((await paper(member.id, 0)).status).toBe(400);

    await prisma.member.update({ where: { id: member.id }, data: { status: 'DISABLED' } });
    try {
      expect((await paper(member.id, 1000)).status).toBe(400);
    } finally {
      await prisma.member.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
    }
    expect(await prisma.signFlow.count({ where: { memberId: member.id } })).toBe(0);
  });

  it('the member sees their own agreement and photos; nobody else outside the store does', async () => {
    const member = await newCard();
    const bytes = jpeg(4096);
    const photoId = await photo(tokens.clerkA, bytes);
    const flow = (await paper(member.id, 30000, { photoIds: [photoId], benefitPlanId: planId })).body;

    const memberToken = await memberLogin(member.phone);
    const mine = await as(memberToken).get('/members/me/sign-flows');
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      id: flow.id,
      kind: 'PAPER',
      status: 'SIGNED',
      sandbox: false,
      recharged: true,
      rechargeReversed: false,
      rechargeAmountCent: 30000,
      photos: [{ id: photoId }],
    });
    expect(mine.body.items[0]).not.toHaveProperty('store');
    expect(mine.body.items[0]).not.toHaveProperty('initiator');
    const image = await as(memberToken).get(`/members/me/sign-flows/${flow.id}/photos/${photoId}`).buffer(true);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(image.body as Buffer, bytes)).toBe(0);

    const benefits = await as(memberToken).get('/members/me/benefits');
    const svip = benefits.body.find((b: { id: string }) => b.id === planId);
    expect(svip.signFlow).toMatchObject({ id: flow.id, status: 'SIGNED' });

    const stranger = await memberLogin(randomPhone());
    expect((await as(stranger).get(`/members/me/sign-flows/${flow.id}`)).status).toBe(404);
    expect((await as(stranger).get(`/members/me/sign-flows/${flow.id}/photos/${photoId}`)).status).toBe(404);

    expect((await as(tokens.clerkA2).get(`/sign-flows/${flow.id}/photos/${photoId}`)).status).toBe(200);
    expect((await as(tokens.super).get(`/sign-flows/${flow.id}/photos/${photoId}`)).status).toBe(200);
    expect((await as(tokens.clerkB).get(`/sign-flows/${flow.id}`)).status).toBe(404);
    expect((await as(tokens.clerkB).get(`/sign-flows/${flow.id}/photos/${photoId}`)).status).toBe(404);
    // 照片号对上了，权益单号不对也不行。
    const other = (await paper(member.id, 100)).body;
    expect((await as(tokens.clerkA).get(`/sign-flows/${other.id}/photos/${photoId}`)).status).toBe(404);
  });

  it('staff can add photos later, up to nine', async () => {
    const member = await newCard();
    const flow = (await paper(member.id, 1000)).body;
    const extra = [await photo(tokens.clerkA2), await photo(tokens.clerkA2)];
    const added = await as(tokens.clerkA2).post(`/sign-flows/${flow.id}/photos`, { photoIds: extra });
    expect(added.status).toBe(201);
    expect(added.body.photos).toHaveLength(3);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { orgId, action: 'AGREEMENT_PHOTO_ADD', targetId: flow.id },
    });
    expect(audit.payloadJson).toMatchObject({ memberId: member.id, photoIds: extra });

    const tooMany = await Promise.all(Array.from({ length: 7 }, () => photo()));
    const refused = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/photos`, { photoIds: tooMany });
    expect(refused.status).toBe(400);
    expect(messageOf(refused.body)).toContain('最多 9 张');
    expect((await as(tokens.clerkB).post(`/sign-flows/${flow.id}/photos`, { photoIds: [await photo(tokens.clerkB)] })).status).toBe(404);
  });

  it('a manager removes a wrong photo, the file is gone, and at least one stays', async () => {
    const member = await newCard();
    const [keep, wrong] = [await photo(), await photo()];
    const flow = (await paper(member.id, 1000, { photoIds: [keep, wrong] })).body;
    const key = (await prisma.agreementPhoto.findUniqueOrThrow({ where: { id: wrong } })).objectKey;
    expect(existsSync(join(storageDir, key))).toBe(true);

    const byClerk = await as(tokens.clerkA).post(`/sign-flows/${flow.id}/photos/${wrong}/remove`, { reason: '拍错了' });
    expect(byClerk.status).toBe(403);
    const noReason = await as(tokens.managerA).post(`/sign-flows/${flow.id}/photos/${wrong}/remove`, { reason: ' ' });
    expect(noReason.status).toBe(400);

    const removed = await as(tokens.managerA).post(`/sign-flows/${flow.id}/photos/${wrong}/remove`, {
      reason: '拍成了别的顾客的单子',
    });
    expect(removed.status).toBe(201);
    expect(removed.body.photos.map((p: { id: string }) => p.id)).toEqual([keep]);
    expect(existsSync(join(storageDir, key))).toBe(false);
    const row = await prisma.agreementPhoto.findUniqueOrThrow({ where: { id: wrong } });
    expect(row.removeReason).toBe('拍成了别的顾客的单子');
    expect(row.removedAt).not.toBeNull();
    expect((await as(tokens.managerA).get(`/sign-flows/${flow.id}/photos/${wrong}`)).status).toBe(404);
    const memberToken = await memberLogin(member.phone);
    expect((await as(memberToken).get(`/members/me/sign-flows/${flow.id}/photos/${wrong}`)).status).toBe(404);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { orgId, action: 'AGREEMENT_PHOTO_REMOVE', targetId: flow.id },
    });
    expect(audit.payloadJson).toMatchObject({ photoId: wrong, reason: '拍成了别的顾客的单子' });

    const last = await as(tokens.super).post(`/sign-flows/${flow.id}/photos/${keep}/remove`, { reason: '再删一张' });
    expect(last.status).toBe(400);
    expect(messageOf(last.body)).toContain('至少要留一张');
  });

  it('shows when the recharge was taken back, and refresh credits a recharge that did not land', async () => {
    const member = await newCard();
    const flow = (await paper(member.id, 8000)).body;
    const reversal = await as(tokens.managerA).post(`/ledger/${flow.rechargeEntryId}/reversal`, {
      remark: '金额填错了',
      requestId: randomUUID(),
    });
    expect(reversal.status).toBe(201);
    expect((await as(tokens.clerkA).get(`/sign-flows/${flow.id}`)).body.rechargeReversed).toBe(true);
    const memberToken = await memberLogin(member.phone);
    expect((await as(memberToken).get(`/members/me/sign-flows/${flow.id}`)).body).toMatchObject({
      recharged: true,
      rechargeReversed: true,
    });

    // 交单后充值那一步出错（进程挂了）：单已经在，刷新时补充值，只充一次。
    const stuck = await newCard();
    const staff = await prisma.staff.findFirstOrThrow({ where: { orgId, phone: phones.clerkA } });
    const orphan = await prisma.signFlow.create({
      data: {
        orgId,
        memberId: stuck.id,
        kind: 'PAPER',
        storeId: storeA,
        initiatorStaffId: staff.id,
        title: '会员协议单',
        status: 'SIGNED',
        signedAt: new Date(),
        rechargeAmountCent: 2500,
      },
    });
    expect((await as(tokens.clerkA).get(`/sign-flows/${orphan.id}`)).body.rechargeEntryId).toBeNull();
    const refreshed = await as(tokens.clerkA).post(`/sign-flows/${orphan.id}/refresh`);
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.rechargeEntryId).toEqual(expect.any(String));
    await as(tokens.clerkA).post(`/sign-flows/${orphan.id}/refresh`);
    expect(await balanceOf(stuck.id)).toBe(2500);
  });

  it('with the e-sign switch on, paper uploads are refused', async () => {
    const member = await newCard();
    process.env.SIGN_MODE = 'esign';
    try {
      expect((await as(tokens.clerkA).get('/sign-flows/config')).body.mode).toBe('ESIGN');
      const refused = await paper(member.id, 1000);
      expect(refused.status).toBe(400);
      expect(messageOf(refused.body)).toContain('电子签');
    } finally {
      delete process.env.SIGN_MODE;
    }
  });

  it('the database keeps paper agreements signed, their kind fixed and attached photos in place', async () => {
    const member = await newCard();
    const photoId = await photo();
    const flow = (await paper(member.id, 1000, { photoIds: [photoId] })).body;
    await expect(prisma.signFlow.update({ where: { id: flow.id }, data: { status: 'PENDING' } })).rejects.toThrow();
    await expect(prisma.signFlow.update({ where: { id: flow.id }, data: { kind: 'ESIGN' } })).rejects.toThrow();
    await expect(prisma.agreementPhoto.delete({ where: { id: photoId } })).rejects.toThrow();
    const other = (await paper(member.id, 1000)).body;
    await expect(
      prisma.agreementPhoto.update({ where: { id: photoId }, data: { signFlowId: other.id } }),
    ).rejects.toThrow();
    // 没交单的照片可以清理。
    const loose = await photo();
    await prisma.agreementPhoto.delete({ where: { id: loose } });
  });
});
