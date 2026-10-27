import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { PrismaClient, StaffRole } from '@prisma/client';

const prisma = new PrismaClient();
const base = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const output =
  process.env.ACCEPTANCE_HTML ?? '/opt/cursor/artifacts/m1-acceptance.html';

interface ApiResult {
  status: number;
  body: unknown;
}

interface Step {
  title: string;
  detail: string;
  tone: 'ok' | 'blocked';
}

const roleLabel: Record<string, string> = {
  SUPER_ADMIN: '超级管理员',
  STORE_MANAGER: '店长',
  STAFF: '店员',
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
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

function expectStatus(result: ApiResult, status: number, label: string): void {
  if (result.status !== status) {
    const safe = JSON.stringify(result.body, (key, value) => (key === 'accessToken' ? '***' : value));
    throw new Error(`${label}：期望状态 ${status}，实际 ${result.status} ${safe}`);
  }
}

function tokenOf(result: ApiResult): string {
  const token = (result.body as { accessToken?: unknown } | null)?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('登录没有返回凭证');
  }
  return token;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await api('/health');
      if (result.status === 200) {
        const body = result.body as { ok?: boolean; esignProductionEnabled?: boolean };
        if (body.ok !== true) {
          throw new Error('服务未就绪');
        }
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

function render(steps: Step[], when: string): string {
  const cards = steps
    .map(
      (step, index) => `<section class="${step.tone}">
        <p class="index">${index + 1}</p>
        <div>
          <h2>${esc(step.title)}</h2>
          <p>${esc(step.detail)}</p>
        </div>
        <p class="badge">${step.tone === 'ok' ? '通过' : '已拒绝'}</p>
      </section>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>账号与门店验收</title>
  <style>
    body { margin: 0; background: #f6f5f2; color: #1d1c1a; font-family: "Noto Sans CJK SC", "Noto Sans SC", sans-serif; }
    main { max-width: 880px; margin: 0 auto; padding: 40px 28px 64px; }
    h1 { font-size: 32px; margin: 0 0 8px; }
    .lead { font-size: 18px; line-height: 1.6; margin: 0 0 8px; }
    .meta { color: #5c584f; margin: 0 0 28px; }
    section { display: grid; grid-template-columns: 42px 1fr auto; gap: 16px; align-items: start; background: #fff; border: 1px solid #e4e0d8; border-radius: 12px; padding: 18px 18px; margin: 0 0 12px; }
    section.ok { border-left: 6px solid #1f7a4d; }
    section.blocked { border-left: 6px solid #9a3b32; }
    .index { margin: 0; font-size: 20px; color: #6b655c; }
    h2 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0; line-height: 1.55; }
    .badge { margin: 0; font-weight: 700; }
    section.ok .badge { color: #1f7a4d; }
    section.blocked .badge { color: #9a3b32; }
    footer { margin-top: 28px; color: #5c584f; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>账号与门店验收</h1>
    <p class="lead">超级管理员建门店、建员工、分配角色。店长只能看自己的店，越权会被拒绝。</p>
    <p class="meta">验收时间：${esc(when)}。结果来自刚刚跑起来的服务，不是手写示例。</p>
    ${cards}
    <footer>
      正式签署保持关闭。没有做小程序里的支付。<br />
      演示没有连接真实微信，用的是开发环境里的测试登录；正式环境不允许用假手机号登录。
    </footer>
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  await waitForHealth();
  const steps: Step[] = [];
  const stamp = Date.now().toString().slice(-6);
  const org = await prisma.org.create({ data: { name: `验收组织${stamp}`, status: 'ACTIVE' } });
  const home = await prisma.store.create({
    data: { orgId: org.id, name: '初始门店', status: 'ACTIVE' },
  });
  const admin = await prisma.staff.create({
    data: { orgId: org.id, phone: '13800010001', name: '超级管理员', status: 'ACTIVE' },
  });
  await prisma.staffStoreRole.create({
    data: { staffId: admin.id, storeId: home.id, role: StaffRole.SUPER_ADMIN },
  });

  const superLogin = await api('/auth/staff/wx-phone', {
    body: { code: 'demo', phoneCode: 'demo', orgId: org.id, mockPhone: '13800010001', mockOpenId: 'demo-admin' },
  });
  expectStatus(superLogin, 201, '超级管理员登录');
  const superToken = tokenOf(superLogin);
  steps.push({ tone: 'ok', title: '超级管理员登录成功', detail: '系统认出了已经开通的超级管理员。' });

  const flagship = await api('/stores', {
    token: superToken,
    body: { name: '旗舰店', address: '示范路 1 号' },
  });
  expectStatus(flagship, 201, '创建旗舰店');
  const community = await api('/stores', {
    token: superToken,
    body: { name: '社区店', address: '示范路 8 号' },
  });
  expectStatus(community, 201, '创建社区店');
  const flagshipId = (flagship.body as { id: string }).id;
  const communityId = (community.body as { id: string }).id;
  steps.push({
    tone: 'ok',
    title: '超级管理员新建了两家门店',
    detail: '新建了「旗舰店」和「社区店」。',
  });

  const manager = await api('/staff', {
    token: superToken,
    body: { phone: '13800010002', name: '张店长', storeId: flagshipId, role: 'STORE_MANAGER' },
  });
  expectStatus(manager, 201, '创建店长');
  const clerk = await api('/staff', {
    token: superToken,
    body: { phone: '13800010003', name: '李店员', storeId: flagshipId, role: 'STAFF' },
  });
  expectStatus(clerk, 201, '创建店员');
  const managerRole = ((manager.body as { roles?: { role?: string; storeName?: string }[] }).roles ?? [])[0];
  const clerkRole = ((clerk.body as { roles?: { role?: string; storeName?: string }[] }).roles ?? [])[0];
  steps.push({
    tone: 'ok',
    title: '超级管理员新建员工并分配角色',
    detail: `张店长分配为${managerRole?.storeName ?? '旗舰店'}的${roleLabel[managerRole?.role ?? ''] ?? '店长'}。李店员分配为${clerkRole?.storeName ?? '旗舰店'}的${roleLabel[clerkRole?.role ?? ''] ?? '店员'}。`,
  });

  const managerLogin = await api('/auth/staff/wx-phone', {
    body: { code: 'demo', phoneCode: 'demo', orgId: org.id, mockPhone: '13800010002', mockOpenId: 'demo-manager' },
  });
  expectStatus(managerLogin, 201, '店长登录');
  const managerToken = tokenOf(managerLogin);
  const managerStores = await api('/stores', { method: 'GET', token: managerToken });
  expectStatus(managerStores, 200, '店长查看门店');
  const seen = ((managerStores.body as { items?: { name?: string }[] }).items ?? []).map((item) => item.name ?? '');
  if (seen.length !== 1 || seen[0] !== '旗舰店') {
    throw new Error(`店长看到的门店不对：${seen.join('、')}`);
  }
  steps.push({
    tone: 'ok',
    title: '店长只能看到自己的店',
    detail: '张店长打开门店列表，只看到「旗舰店」，没有看到「社区店」。',
  });

  const cross = await api(`/stores/${communityId}`, { method: 'GET', token: managerToken });
  expectStatus(cross, 403, '店长查看社区店');
  steps.push({
    tone: 'blocked',
    title: '店长查看另一家店被拒绝',
    detail: `张店长试图打开「社区店」，系统回答「${messageOf(cross.body)}」。`,
  });

  const clerkLogin = await api('/auth/staff/wx-phone', {
    body: { code: 'demo', phoneCode: 'demo', orgId: org.id, mockPhone: '13800010003', mockOpenId: 'demo-clerk' },
  });
  expectStatus(clerkLogin, 201, '店员登录');
  const clerkToken = tokenOf(clerkLogin);
  const clerkCreate = await api('/stores', { token: clerkToken, body: { name: '店员私自建店' } });
  expectStatus(clerkCreate, 403, '店员建店');
  steps.push({
    tone: 'blocked',
    title: '店员不能做管理员的事',
    detail: `李店员试图新建门店，系统回答「${messageOf(clerkCreate.body)}」。`,
  });

  const memberLogin = await api('/auth/member/wx-phone', {
    body: { code: 'demo', phoneCode: 'demo', orgId: org.id, mockPhone: '13800010004', mockOpenId: 'demo-member' },
  });
  expectStatus(memberLogin, 201, '会员登录');
  const memberToken = tokenOf(memberLogin);
  const memberStaff = await api('/staff', { method: 'GET', token: memberToken });
  expectStatus(memberStaff, 403, '会员查看员工');
  const memberMe = await api('/members/me', { method: 'GET', token: memberToken });
  expectStatus(memberMe, 200, '会员查看自己');
  const memberBody = memberMe.body as { needsCard?: boolean };
  if (memberBody.needsCard !== true || (memberMe.body as { balanceCent?: unknown }).balanceCent !== undefined) {
    throw new Error('会员资料不应包含余额，且应提示尚未开卡');
  }
  steps.push({
    tone: 'blocked',
    title: '会员进不了员工功能',
    detail: `会员只能看自己的资料，还没有开卡，也没有余额。查看员工时，系统回答「${messageOf(memberStaff.body)}」。`,
  });

  const logs = await prisma.auditLog.findMany({
    where: { orgId: org.id, action: { in: ['STORE_CREATE', 'STAFF_CREATE'] } },
    include: { actor: true },
    orderBy: { createdAt: 'asc' },
  });
  const storeNames = new Map<string, string>([
    [flagshipId, '旗舰店'],
    [communityId, '社区店'],
  ]);
  const lines = logs.map((log) => {
    const actor = log.actor?.name ?? '未知人员';
    if (log.action === 'STORE_CREATE') {
      return `${actor}创建了「${storeNames.get(log.targetId ?? '') ?? '门店'}」`;
    }
    const payload = log.payloadJson as { name?: string } | null;
    return `${actor}创建了员工「${payload?.name ?? ''}」`;
  });
  if (!lines.some((line) => line.includes('旗舰店')) || !lines.some((line) => line.includes('张店长'))) {
    throw new Error(`操作记录不完整：${lines.join('；')}`);
  }
  steps.push({
    tone: 'ok',
    title: '关键操作留下了记录',
    detail: `${lines.join('；')}。`,
  });

  const when = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, render(steps, when), 'utf8');
  console.log(`acceptance html written ${output}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
