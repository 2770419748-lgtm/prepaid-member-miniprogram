import { ConfigService } from '@nestjs/config';
import { PrismaClient, StaffRole } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { EsignConfigService } from '../src/esign-config/esign-config.service';
import { FakeEsign } from '../test/support/fake-esign';

/**
 * M4 电子签沙箱验收演示。对着正在运行的本地服务一步步操作，把真实结果写成一页 HTML。
 * e签宝用本机假沙箱代替（本脚本自己启动，独立校验请求签名），不需要真实沙箱凭据。
 *
 * 先启动本地服务，让它指向假沙箱：
 *   WECHAT_PHONE_MOCK=true ESIGN_API_HOST=http://127.0.0.1:3901 \
 *   ESIGN_APP_ID=demo-app ESIGN_APP_SECRET=demo-secret pnpm --filter api start:dev
 * 再运行：
 *   API_BASE=http://127.0.0.1:3000 pnpm --filter api exec tsx scripts/m4-acceptance-demo.ts
 */

const prisma = new PrismaClient();
const base = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const output = process.env.ACCEPTANCE_HTML ?? join(tmpdir(), 'm4-acceptance.html');
const fakePort = Number(process.env.FAKE_ESIGN_PORT ?? 3901);
const fake = new FakeEsign(process.env.ESIGN_APP_ID ?? 'demo-app', process.env.ESIGN_APP_SECRET ?? 'demo-secret');

interface ApiResult {
  status: number;
  body: unknown;
  bytes: Buffer;
}

interface Step {
  title: string;
  detail: string;
  tone: 'ok' | 'blocked';
}

interface FlowRow {
  id: string;
  status: string;
  env: string;
  member: { phone: string; name: string | null };
  template: { name: string };
  store: { name: string } | null;
  initiator: { name: string } | null;
  hasPdf: boolean;
  signUrl: string | null;
}

const statusLabel: Record<string, string> = {
  DRAFT: '发起中',
  PENDING: '待签署',
  SIGNED: '已签署',
  REJECTED: '已拒签',
  EXPIRED: '已过期',
  CANCELED: '已撤销',
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object' || !('message' in body)) {
    return '系统拒绝了这次操作';
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : '系统拒绝了这次操作';
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST'),
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') && bytes.length > 0 ? (JSON.parse(bytes.toString('utf8')) as unknown) : null;
  return { status: response.status, body, bytes };
}

function expectStatus(result: ApiResult, status: number, label: string): void {
  if (result.status !== status) {
    const safe = JSON.stringify(result.body, (key, value) => (key === 'accessToken' ? '***' : value));
    throw new Error(`${label}：期望状态 ${status}，实际 ${result.status} ${safe}`);
  }
}

async function login(path: string, orgId: string, phone: string): Promise<string> {
  const result = await api(path, {
    body: { code: 'demo', phoneCode: 'demo', orgId, mockPhone: phone, mockOpenId: `demo-${phone}` },
  });
  expectStatus(result, 201, `${phone} 登录`);
  const token = (result.body as { accessToken?: unknown }).accessToken;
  if (typeof token !== 'string') {
    throw new Error('登录没有返回凭证');
  }
  return token;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await api('/health');
      const body = result.body as { ok?: boolean; esignProductionEnabled?: boolean };
      if (result.status === 200 && body.ok === true) {
        if (body.esignProductionEnabled !== false) {
          throw new Error('正式签署开关不是关闭状态');
        }
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('正式签署')) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('服务没有在预期时间内启动');
}

function render(steps: Step[], flows: FlowRow[], when: string): string {
  const cards = steps
    .map(
      (step, index) => `<section class="${step.tone}">
        <p class="index">${index + 1}</p>
        <div>
          <h2>${esc(step.title)}</h2>
          <p>${esc(step.detail)}</p>
        </div>
        <p class="badge">${step.tone === 'ok' ? '通过' : '已拦住'}</p>
      </section>`,
    )
    .join('\n');
  const rows = flows
    .map(
      (flow) => `<tr>
        <td>${esc(flow.member.name ?? flow.member.phone)}</td>
        <td>${esc(flow.template.name)}</td>
        <td>${esc(flow.store?.name ?? '')}</td>
        <td>${esc(flow.initiator?.name ?? '')}</td>
        <td><span class="tag ${flow.status.toLowerCase()}">${esc(statusLabel[flow.status] ?? flow.status)}</span></td>
        <td>${flow.env === 'SANDBOX' ? '测试签署（沙箱）' : '正式'}</td>
        <td>${flow.hasPdf ? '已归档' : '—'}</td>
      </tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>电子签沙箱验收</title>
  <style>
    body { margin: 0; background: #f5f7fa; color: #1f2329; font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 40px 28px 64px; }
    h1 { font-size: 30px; margin: 0 0 8px; }
    .lead { font-size: 17px; line-height: 1.6; margin: 0 0 6px; }
    .meta { color: #646a73; margin: 0 0 28px; }
    section { display: grid; grid-template-columns: 36px 1fr auto; gap: 14px; align-items: start; background: #fff; border: 1px solid #e5e6eb; border-radius: 12px; padding: 16px 18px; margin: 0 0 10px; }
    section.ok { border-left: 6px solid #1677ff; }
    section.blocked { border-left: 6px solid #f5222d; }
    .index { margin: 0; font-size: 18px; color: #8f959e; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    p { margin: 0; line-height: 1.55; }
    .badge { margin: 0; font-weight: 700; white-space: nowrap; }
    section.ok .badge { color: #1677ff; }
    section.blocked .badge { color: #f5222d; }
    h3 { margin: 32px 0 12px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e6eb; border-radius: 12px; overflow: hidden; font-size: 14px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #f0f1f5; text-align: left; }
    th { background: #f7f8fa; color: #646a73; font-weight: 600; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 13px; background: #f0f1f5; color: #646a73; }
    .tag.signed { background: #e8f3ff; color: #1677ff; }
    .tag.pending { background: #fff7e8; color: #d46b08; }
    footer { margin-top: 28px; color: #646a73; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>电子签沙箱验收</h1>
    <p class="lead">商家在后台配好权益单，选会员发起；会员在小程序里签名，商家企业章自动盖上；签完的合同 PDF 自动存档，会员和门店都能下载。</p>
    <p class="meta">验收时间：${esc(when)}。下面每一步都是刚刚对着运行中的服务真实操作的结果。e签宝一侧用本机模拟的沙箱代替，请求签名按 e签宝规则逐条校验。</p>
    ${cards}
    <h3>商家后台看到的权益单</h3>
    <table>
      <thead><tr><th>会员</th><th>权益单</th><th>发起门店</th><th>发起人</th><th>状态</th><th>环境</th><th>合同</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>
      正式签署开关保持关闭：现在只会连 e签宝 沙箱，签出来的是测试合同，没有法律效力，也不计费。<br />
      等 12 月公司主体和企业章办好，再按 docs/esign-switch.md 切换正式环境。
    </footer>
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  await fake.start(fakePort);
  fake.templates.set('demo-benefit-template', {
    name: '储值会员权益单',
    componentKeys: ['memberPhone', 'benefitTitle', 'signDate', 'contractNo'],
    keywords: ['会员签字', '商家盖章'],
  });
  await waitForHealth();
  const steps: Step[] = [];
  const stamp = Date.now().toString().slice(-6);
  const tail = stamp.slice(-4);
  const phone = (n: number) => `137${tail}000${String(n)}`;
  const org = await prisma.org.create({ data: { name: `电子签验收${stamp}`, status: 'ACTIVE' } });
  const flagship = await prisma.store.create({ data: { orgId: org.id, name: '旗舰店', status: 'ACTIVE' } });
  const community = await prisma.store.create({ data: { orgId: org.id, name: '社区店', status: 'ACTIVE' } });
  const people: [string, string, StaffRole, string][] = [
    [phone(1), '超级管理员', StaffRole.SUPER_ADMIN, flagship.id],
    [phone(2), '张店长', StaffRole.STORE_MANAGER, flagship.id],
    [phone(3), '李店员', StaffRole.STAFF, flagship.id],
    [phone(4), '社区店员', StaffRole.STAFF, community.id],
  ];
  for (const [mobile, name, role, storeId] of people) {
    await prisma.staff.create({
      data: { orgId: org.id, phone: mobile, name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
    });
  }
  const superToken = await login('/auth/staff/wx-phone', org.id, phone(1));
  const managerToken = await login('/auth/staff/wx-phone', org.id, phone(2));
  const clerkToken = await login('/auth/staff/wx-phone', org.id, phone(3));
  const outsiderToken = await login('/auth/staff/wx-phone', org.id, phone(4));
  const wang = phone(6);
  const zhao = phone(7);
  const wangToken = await login('/auth/member/wx-phone', org.id, wang);
  const zhaoToken = await login('/auth/member/wx-phone', org.id, zhao);
  const opened = await api('/members/open', { token: clerkToken, body: { phone: wang, name: '王女士', storeId: flagship.id } });
  expectStatus(opened, 201, '给王女士开卡');
  const wangId = (opened.body as { id: string }).id;
  const zhaoOpened = await api('/members/open', { token: clerkToken, body: { phone: zhao, name: '赵先生', storeId: flagship.id } });
  expectStatus(zhaoOpened, 201, '给赵先生开卡');
  const zhaoId = (zhaoOpened.body as { id: string }).id;

  const plan = await api('/benefit-plans', {
    token: superToken,
    body: {
      title: '储值会员权益',
      summary: '储值后全部门店通用',
      items: [{ title: '全场项目 9 折' }, { title: '生日月赠送护理一次' }, { title: '储值终身有效，用完为止' }],
      rules: '储值金额不可提现，不做赠送金。',
    },
  });
  expectStatus(plan, 201, '新建权益方案');
  const planId = (plan.body as { id: string }).id;
  const clerkPlan = await api('/benefit-plans', { token: clerkToken, body: { title: '店员自建', items: [{ title: 'x' }] } });
  expectStatus(clerkPlan, 403, '店员新建权益方案');
  steps.push({
    tone: 'ok',
    title: '超管在后台建好「储值会员权益」，店员不能改',
    detail: '三条权益：全场项目 9 折、生日月赠送护理一次、储值终身有效。李店员想自己建一份，被拒绝。',
  });

  const wrongTemplate = await api('/contract-templates', {
    token: superToken,
    body: { esignTemplateId: 'typo-template', name: '填错的模板' },
  });
  expectStatus(wrongTemplate, 400, '绑定填错的模板');
  const template = await api('/contract-templates', {
    token: superToken,
    body: { esignTemplateId: 'demo-benefit-template', name: '储值会员权益单', benefitPlanId: planId },
  });
  expectStatus(template, 201, '绑定模板');
  const templateId = (template.body as { id: string }).id;
  steps.push({
    tone: 'blocked',
    title: '绑定 e签宝 模板时先核对，填错的模板号当场拦住',
    detail: `模板号填错时提示「${messageOf(wrongTemplate.body)}」。填对后绑定成功，并和「储值会员权益」关联。`,
  });

  const created = await api('/sign-flows', {
    token: clerkToken,
    body: { memberId: wangId, templateId, storeId: flagship.id },
  });
  expectStatus(created, 201, '发起签署');
  const flow = created.body as FlowRow;
  const esignBody = fake.callsTo('/v3/sign-flow/create-by-file').at(-1)!.body as {
    signers: { signerType: number; signFields: { normalSignFieldConfig: { autoSign: boolean } }[] }[];
  };
  const memberFirst = esignBody.signers[0].signerType === 0 && !esignBody.signers[0].signFields[0].normalSignFieldConfig.autoSign;
  const sealAuto = esignBody.signers[1].signerType === 1 && esignBody.signers[1].signFields[0].normalSignFieldConfig.autoSign;
  if (flow.env !== 'SANDBOX' || flow.status !== 'PENDING' || !flow.signUrl || !memberFirst || !sealAuto) {
    throw new Error('发起结果不符合预期');
  }
  if (!fake.calls.every((call) => call.signatureOk)) {
    throw new Error('有请求没通过 e签宝 签名校验');
  }
  steps.push({
    tone: 'ok',
    title: '李店员在旗舰店给王女士发起权益单',
    detail: '状态「待签署」，环境是沙箱（测试签署），拿到了会员签署链接。发给 e签宝 的内容：王女士先签名，签完由系统自动盖商家企业章。每个请求都带了正确的签名。',
  });

  const again = await api('/sign-flows', { token: managerToken, body: { memberId: wangId, templateId, storeId: flagship.id } });
  expectStatus(again, 409, '重复发起');
  steps.push({
    tone: 'blocked',
    title: '同一份权益单不能重复发给同一位会员',
    detail: `张店长又点了一次发起，提示「${messageOf(again.body)}」。e签宝 按份计费，这样不会白白多算一份。`,
  });

  const outsiderList = await api('/sign-flows', { token: outsiderToken });
  expectStatus(outsiderList, 200, '社区店员查列表');
  const outsiderGet = await api(`/sign-flows/${flow.id}`, { token: outsiderToken });
  expectStatus(outsiderGet, 404, '社区店员查旗舰店的权益单');
  steps.push({
    tone: 'blocked',
    title: '社区店员看不到旗舰店发起的权益单',
    detail: `社区店员的列表里有 ${(outsiderList.body as { total: number }).total} 份；直接打开旗舰店那份，提示不存在。超管能看全部。`,
  });

  const mine = await api('/members/me/sign-flows', { token: wangToken });
  expectStatus(mine, 200, '王女士查自己的权益单');
  const mineItems = (mine.body as { items: Record<string, unknown>[] }).items;
  const mineText = JSON.stringify(mineItems);
  if (mineItems.length !== 1 || mineText.includes('李店员') || mineItems[0].sandbox !== true) {
    throw new Error('会员端权益单内容不符合预期');
  }
  const link = await api(`/members/me/sign-flows/${flow.id}/sign-url`, { token: wangToken, method: 'POST' });
  expectStatus(link, 201, '王女士取签署链接');
  steps.push({
    tone: 'ok',
    title: '王女士在小程序里看到一份「测试签署」的权益单',
    detail: '能看到权益内容和状态，取到了签署链接；看不到是哪位店员发的。',
  });

  const peek = await api(`/members/me/sign-flows/${flow.id}`, { token: zhaoToken });
  expectStatus(peek, 404, '赵先生偷看王女士的权益单');
  steps.push({
    tone: 'blocked',
    title: '别的会员打不开王女士的权益单',
    detail: '赵先生用王女士那份的编号去打开，提示不存在。会员只能看自己的。',
  });

  const { esignFlowId } = await prisma.signFlow.findUniqueOrThrow({ where: { id: flow.id } });
  if (!esignFlowId) {
    throw new Error('没有 e签宝 流程号');
  }
  fake.complete(esignFlowId);
  const callback = JSON.stringify({ action: 'SIGN_FLOW_COMPLETE', signFlowId: esignFlowId, signFlowStatus: '2' });
  const forged = await api('/webhooks/esign', {
    raw: callback,
    headers: { ...fake.callbackHeaders(callback, { secret: 'guessed-secret' }) },
  });
  expectStatus(forged, 401, '伪造回调');
  const stillPending = await api(`/sign-flows/${flow.id}`, { token: clerkToken });
  if ((stillPending.body as FlowRow).status !== 'PENDING') {
    throw new Error('伪造回调不应改变状态');
  }
  steps.push({
    tone: 'blocked',
    title: '有人冒充 e签宝 发「已签完」通知，被拒绝',
    detail: '通知的签名对不上，系统直接拒收，权益单仍是「待签署」。',
  });

  const real = await api('/webhooks/esign', { raw: callback, headers: fake.callbackHeaders(callback) });
  expectStatus(real, 200, '真实回调');
  const signed = await api(`/sign-flows/${flow.id}`, { token: clerkToken });
  const signedFlow = signed.body as FlowRow;
  if (signedFlow.status !== 'SIGNED' || !signedFlow.hasPdf) {
    throw new Error('签完后应为已签署并已归档');
  }
  steps.push({
    tone: 'ok',
    title: '王女士签完，e签宝 通知过来，状态变成「已签署」',
    detail: '系统收到签名正确的通知后，又回头向 e签宝 核对了一次，确认签完才改状态；签好的合同 PDF 自动存进了文件库。',
  });

  const pdf = await api(`/members/me/sign-flows/${flow.id}/pdf`, { token: wangToken });
  expectStatus(pdf, 200, '王女士下载合同');
  if (pdf.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('下载到的不是 PDF');
  }
  const benefits = await api('/members/me/benefits', { token: wangToken });
  expectStatus(benefits, 200, '王女士看权益');
  const first = (benefits.body as { title: string; signFlow: { status: string } | null }[])[0];
  if (first.signFlow?.status !== 'SIGNED') {
    throw new Error('权益列表应把已签的排第一');
  }
  steps.push({
    tone: 'ok',
    title: '王女士能下载自己签好的合同，首页权益显示「已签署」',
    detail: `下载到一份 PDF（${pdf.bytes.length} 字节，演示用的模拟合同）。首页权益卡片排在第一位的是她签过的「${first.title}」。`,
  });

  const second = await api('/sign-flows', { token: clerkToken, body: { memberId: zhaoId, templateId, storeId: flagship.id } });
  expectStatus(second, 201, '给赵先生发起');
  const secondId = (second.body as FlowRow).id;
  const clerkCancel = await api(`/sign-flows/${secondId}/cancel`, { token: clerkToken, body: { reason: '发错人了' } });
  expectStatus(clerkCancel, 403, '店员撤销');
  const managerCancel = await api(`/sign-flows/${secondId}/cancel`, { token: managerToken, body: { reason: '发错人了' } });
  expectStatus(managerCancel, 201, '店长撤销');
  steps.push({
    tone: 'ok',
    title: '发错的权益单，店长可以撤销，店员不行',
    detail: '李店员给赵先生发错了一份。李店员自己撤销被拒绝；张店长撤销成功，e签宝 那边也同步撤掉了。',
  });

  const guard = new EsignConfigService({
    get: (key: string) =>
      ({ ESIGN_API_HOST: 'https://openapi.esign.cn', ESIGN_PRODUCTION_ENABLED: 'false' })[key],
  } as unknown as ConfigService);
  let refused = false;
  try {
    guard.resolveTarget();
  } catch {
    refused = true;
  }
  const health = await api('/health');
  if (!refused || (health.body as { esignProductionEnabled: boolean }).esignProductionEnabled !== false) {
    throw new Error('正式开关护栏不符合预期');
  }
  steps.push({
    tone: 'blocked',
    title: '正式签署开关关着，就连不上 e签宝 正式环境',
    detail: '服务自检显示正式签署开关为关闭。就算有人把地址改成 e签宝 正式网关，系统也会在发请求前拒绝，库里不留记录。',
  });

  const list = await api('/sign-flows?pageSize=50', { token: superToken });
  expectStatus(list, 200, '超管查列表');
  const rows = (list.body as { items: FlowRow[] }).items;
  if (rows.some((row) => row.env !== 'SANDBOX')) {
    throw new Error('只应有沙箱流程');
  }

  const when = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, render(steps, rows, when), 'utf8');
  console.log(`m4 acceptance ok: ${steps.length} steps, ${rows.length} flows → ${output}`);
}

main()
  .then(async () => {
    await fake.stop();
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await fake.stop();
    await prisma.$disconnect();
    process.exit(1);
  });
