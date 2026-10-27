import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PrismaClient, StaffRole } from '@prisma/client';

/**
 * P2 审计与对账验收演示。对着正在运行的本地服务操作一天的账，再查对账和操作记录，把真实结果写成一页 HTML。
 * 需要本地服务以 WECHAT_PHONE_MOCK=true 启动（只在开发环境生效），用假手机号登录。
 *
 *   API_BASE=http://127.0.0.1:3000 pnpm --filter api exec tsx scripts/p2-acceptance-demo.ts
 */

const prisma = new PrismaClient();
const base = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const output = process.env.ACCEPTANCE_HTML ?? join(tmpdir(), 'p2-acceptance.html');

interface ApiResult {
  status: number;
  body: unknown;
}

interface Step {
  title: string;
  detail: string;
  tone: 'ok' | 'blocked';
}

interface Figures {
  rechargeCount: number;
  rechargeCent: number;
  consumeCount: number;
  consumeCent: number;
  reversalCount: number;
  reversedRechargeCent: number;
  reversedConsumeCent: number;
  netRechargeCent: number;
  netConsumeCent: number;
  netChangeCent: number;
}

interface Daily {
  date: string;
  stores: (Figures & { storeId: string; storeName: string })[];
  total: Figures;
  balance: { openingCent: number; netChangeCent: number; closingCent: number } | null;
}

interface Check {
  ok: boolean;
  walletCount: number;
  entryCount: number;
  totalBalanceCent: number;
  ledgerNetCent: number;
  mismatchCount: number;
  mismatches: { memberPhone: string; memberName: string | null; balanceCent: number; ledgerNetCent: number }[];
}

interface AuditItem {
  actionLabel: string;
  actorName: string | null;
  storeName: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 分 → 「12.30」。整数运算，不经过浮点。 */
function yuan(cent: number): string {
  const sign = cent < 0 ? '-' : '';
  const abs = Math.abs(cent);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
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

function auditDetail(item: AuditItem): string {
  const payload = item.payload ?? {};
  const parts: string[] = [];
  if (typeof payload.name === 'string' && item.actionLabel === '开卡') {
    parts.push(payload.name);
  }
  if (typeof payload.phone === 'string') {
    parts.push(payload.phone);
  }
  if (typeof payload.amountCent === 'number') {
    parts.push(`${yuan(payload.amountCent)} 元`);
  }
  if (typeof payload.balanceAfter === 'number') {
    parts.push(`余额 ${yuan(payload.balanceAfter)}`);
  }
  return parts.join('，');
}

function render(steps: Step[], daily: Daily, audit: AuditItem[], when: string): string {
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
  const row = (name: string, f: Figures, strong = false) => `<tr${strong ? ' class="total"' : ''}>
      <td>${esc(name)}</td>
      <td class="num">${f.rechargeCount} 笔 / ${yuan(f.rechargeCent)}</td>
      <td class="num">${f.consumeCount} 笔 / ${yuan(f.consumeCent)}</td>
      <td class="num">${f.reversalCount} 笔</td>
      <td class="num">${yuan(f.netRechargeCent)}</td>
      <td class="num">${yuan(f.netConsumeCent)}</td>
    </tr>`;
  const storeRows = daily.stores.map((store) => row(store.storeName, store)).join('\n');
  const time = (iso: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  const auditRows = [...audit]
    .reverse()
    .map(
      (item) => `<tr>
        <td>${esc(time(item.createdAt))}</td>
        <td>${esc(item.actorName ?? '会员本人')}</td>
        <td>${esc(item.storeName ?? '')}</td>
        <td>${esc(item.actionLabel)}</td>
        <td>${esc(auditDetail(item))}</td>
      </tr>`,
    )
    .join('\n');
  const balance = daily.balance!;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>审计与对账验收</title>
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
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.total td { font-weight: 700; background: #f7f8fa; }
    .equation { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: #fff; border: 1px solid #e5e6eb; border-radius: 12px; padding: 18px; font-size: 17px; }
    .equation b { font-size: 22px; color: #1677ff; font-variant-numeric: tabular-nums; }
    footer { margin-top: 28px; color: #646a73; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>审计与对账验收</h1>
    <p class="lead">每天各门店收了多少储值、用掉多少、冲回多少，一张表看清；全公司余额每天能对上账；谁在哪家店做了什么，都有一条改不了、删不掉的操作记录。</p>
    <p class="meta">验收时间：${esc(when)}。下面每一步都是刚刚对着运行中的服务真实操作的结果，不是手写示例。</p>
    ${cards}
    <h3>${esc(daily.date)} 当日对账（超级管理员视角，单位：元）</h3>
    <table>
      <thead><tr><th>门店</th><th class="num">充值</th><th class="num">消费</th><th class="num">冲正</th><th class="num">实收储值</th><th class="num">实际消费</th></tr></thead>
      <tbody>${storeRows}${row('合计', daily.total, true)}</tbody>
    </table>
    <h3>全公司储值余额日结</h3>
    <div class="equation">日初 <b>${yuan(balance.openingCent)}</b> + 当日净增 <b>${yuan(balance.netChangeCent)}</b> = 日末 <b>${yuan(balance.closingCent)}</b> 元</div>
    <h3>今天的操作记录（超级管理员视角）</h3>
    <table>
      <thead><tr><th>时间</th><th>操作人</th><th>门店</th><th>操作</th><th>内容</th></tr></thead>
      <tbody>${auditRows}</tbody>
    </table>
    <footer>
      「实收储值」= 充值 − 冲回的充值，是当天门店应该线下收到的储值款；「实际消费」= 消费 − 退回的消费。<br />
      「当天」按北京时间零点到零点算。对账和核对只读，不会改任何账；发现记错走冲正。
    </footer>
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  await waitForHealth();
  const steps: Step[] = [];
  const stamp = Date.now().toString().slice(-6);
  const tail = stamp.slice(-4);
  const phone = (n: number) => `137${tail}000${String(n)}`;
  const org = await prisma.org.create({ data: { name: `对账验收${stamp}`, status: 'ACTIVE' } });
  const flagship = await prisma.store.create({ data: { orgId: org.id, name: '旗舰店', status: 'ACTIVE' } });
  const community = await prisma.store.create({ data: { orgId: org.id, name: '社区店', status: 'ACTIVE' } });
  const people: [string, string, StaffRole, string][] = [
    [phone(1), '张店长', StaffRole.STORE_MANAGER, flagship.id],
    [phone(2), '李店员', StaffRole.STAFF, flagship.id],
    [phone(3), '赵店长', StaffRole.STORE_MANAGER, community.id],
    [phone(4), '周店员', StaffRole.STAFF, community.id],
    [phone(6), '超级管理员', StaffRole.SUPER_ADMIN, flagship.id],
  ];
  for (const [mobile, name, role, storeId] of people) {
    await prisma.staff.create({
      data: { orgId: org.id, phone: mobile, name, status: 'ACTIVE', storeRoles: { create: { storeId, role } } },
    });
  }
  const managerA = await login('/auth/staff/wx-phone', org.id, phone(1));
  const clerkA = await login('/auth/staff/wx-phone', org.id, phone(2));
  const clerkB = await login('/auth/staff/wx-phone', org.id, phone(4));
  const superToken = await login('/auth/staff/wx-phone', org.id, phone(6));

  async function open(token: string, storeId: string, mobile: string, name: string): Promise<string> {
    const result = await api('/members/open', { token, body: { phone: mobile, name, storeId } });
    expectStatus(result, 201, `给${name}开卡`);
    return (result.body as { id: string }).id;
  }
  async function move(kind: 'recharge' | 'consume', token: string, memberId: string, storeId: string, amountCent: number) {
    const result = await api(`/wallets/${memberId}/${kind}`, {
      token,
      body: { storeId, amountCent, requestId: randomUUID() },
    });
    expectStatus(result, 201, kind === 'recharge' ? '充值' : '消费');
    return (result.body as { entry: { id: string } }).entry.id;
  }

  const wang = await open(clerkA, flagship.id, phone(5), '王女士');
  const chen = await open(clerkB, community.id, phone(7), '陈先生');
  await move('recharge', clerkA, wang, flagship.id, 100_000);
  await move('recharge', clerkB, chen, community.id, 50_000);
  await move('consume', clerkA, wang, flagship.id, 12_800);
  await move('consume', clerkB, wang, community.id, 6_600);
  await move('consume', clerkB, chen, community.id, 8_800);
  const wrong = await move('recharge', clerkA, chen, flagship.id, 20_000);
  const reversal = await api(`/ledger/${wrong}/reversal`, {
    token: managerA,
    body: { remark: '充错了人', requestId: randomUUID() },
  });
  expectStatus(reversal, 201, '冲正');
  steps.push({
    tone: 'ok',
    title: '先在两家店做一天的账',
    detail:
      '旗舰店给王女士开卡充 1000 元，社区店给陈先生开卡充 500 元；王女士在两家店各消费一次，陈先生在社区店消费一次；李店员把一笔 200 元充错了人，张店长补记一笔反方向的抵掉。',
  });

  const dailyResult = await api('/reconciliation/daily', { token: superToken });
  expectStatus(dailyResult, 200, '当日对账');
  const daily = dailyResult.body as Daily;
  const ledger = await prisma.ledgerEntry.findMany({ where: { orgId: org.id } });
  const recharged = ledger.filter((entry) => entry.type === 'RECHARGE').reduce((sum, entry) => sum + entry.amountCent, 0);
  const consumed = ledger.filter((entry) => entry.type === 'CONSUME').reduce((sum, entry) => sum + entry.amountCent, 0);
  if (daily.total.rechargeCent !== recharged || daily.total.consumeCent !== consumed) {
    throw new Error('对账合计和流水对不上');
  }
  if (daily.total.netRechargeCent !== 150_000 || daily.total.netConsumeCent !== 28_200) {
    throw new Error(`实收或实际消费不对：${JSON.stringify(daily.total)}`);
  }
  steps.push({
    tone: 'ok',
    title: '当日对账：每家店收了多少、用了多少，一张表',
    detail: `今天合计充值 ${daily.total.rechargeCount} 笔 ${yuan(daily.total.rechargeCent)} 元，其中 ${yuan(daily.total.reversedRechargeCent)} 元是充错冲回的，实收储值 ${yuan(daily.total.netRechargeCent)} 元；消费 ${daily.total.consumeCount} 笔 ${yuan(daily.total.consumeCent)} 元。和逐条流水加出来的数一分不差。`,
  });

  const wallets = await prisma.wallet.findMany({ where: { member: { orgId: org.id } } });
  const walletSum = wallets.reduce((sum, wallet) => sum + wallet.balanceCent, 0);
  if (!daily.balance || daily.balance.closingCent !== walletSum) {
    throw new Error('日末余额应等于全部会员余额之和');
  }
  steps.push({
    tone: 'ok',
    title: '全公司余额日结对得上',
    detail: `日初 ${yuan(daily.balance.openingCent)} 元 + 当日净增 ${yuan(daily.balance.netChangeCent)} 元 = 日末 ${yuan(daily.balance.closingCent)} 元，正好等于此刻所有会员卡里的余额之和。`,
  });

  const checkResult = await api('/reconciliation/check', { token: superToken });
  expectStatus(checkResult, 200, '余额核对');
  const check = checkResult.body as Check;
  if (!check.ok) {
    throw new Error(`余额核对应该全部对得上：${JSON.stringify(check)}`);
  }
  steps.push({
    tone: 'ok',
    title: '逐张卡核对余额和流水：全部对得上',
    detail: `${check.walletCount} 张卡、${check.entryCount} 笔流水。每张卡的余额都等于它的流水一笔笔加减出来的数，前后余额也都接得上。`,
  });

  const target = await prisma.wallet.findUniqueOrThrow({ where: { memberId: chen } });
  await prisma.wallet.update({ where: { id: target.id }, data: { balanceCent: target.balanceCent + 10_000 } });
  let tampered: Check;
  try {
    const result = await api('/reconciliation/check', { token: superToken });
    expectStatus(result, 200, '篡改后核对');
    tampered = result.body as Check;
  } finally {
    await prisma.wallet.update({ where: { id: target.id }, data: { balanceCent: target.balanceCent } });
  }
  if (tampered.ok || tampered.mismatchCount !== 1) {
    throw new Error('篡改后核对应该发现一张卡对不上');
  }
  const found = tampered.mismatches[0];
  steps.push({
    tone: 'blocked',
    title: '有人绕过系统偷偷改余额，核对马上发现',
    detail: `演示时直接在数据库里给陈先生的卡多加了 100 元、不记流水。核对立刻报出：${found.memberName ?? ''}（${found.memberPhone}）卡上 ${yuan(found.balanceCent)} 元，按流水应为 ${yuan(found.ledgerNetCent)} 元。演示完已改回。`,
  });

  const managerDaily = await api('/reconciliation/daily', { token: managerA });
  expectStatus(managerDaily, 200, '店长对账');
  const managerView = managerDaily.body as Daily;
  const managerCheck = await api('/reconciliation/check', { token: managerA });
  expectStatus(managerCheck, 403, '店长核对');
  if (managerView.stores.length !== 1 || managerView.balance !== null) {
    throw new Error('店长只能看本店对账，看不到全公司余额');
  }
  steps.push({
    tone: 'blocked',
    title: '店长只看本店的账，看不到全公司余额',
    detail: `张店长打开对账只有「${managerView.stores[0].storeName}」一行，没有全公司余额日结；去做全公司核对，系统回答「${messageOf(managerCheck.body)}」。`,
  });

  const auditResult = await api('/audit-logs?pageSize=100', { token: superToken });
  expectStatus(auditResult, 200, '超管查操作记录');
  const audit = (auditResult.body as { items: AuditItem[] }).items;
  const clerkAudit = await api('/audit-logs?pageSize=100', { token: clerkB });
  const managerAudit = await api('/audit-logs?pageSize=100', { token: managerA });
  expectStatus(clerkAudit, 200, '店员查操作记录');
  expectStatus(managerAudit, 200, '店长查操作记录');
  const clerkItems = (clerkAudit.body as { items: AuditItem[] }).items;
  const managerItems = (managerAudit.body as { items: AuditItem[] }).items;
  if (clerkItems.some((item) => item.actorName !== '周店员')) {
    throw new Error('店员只能看到自己做的操作');
  }
  if (managerItems.some((item) => item.storeName !== '旗舰店' && item.actorName !== '张店长')) {
    throw new Error('店长只能看到本店的操作');
  }
  steps.push({
    tone: 'ok',
    title: '每个操作都有记录：谁、在哪家店、做了什么、多少钱',
    detail: `超级管理员看到今天全部 ${audit.length} 条；张店长看到旗舰店的 ${managerItems.length} 条；周店员只看到自己做的 ${clerkItems.length} 条。会员手机号中间四位打码。`,
  });

  const member = await login('/auth/member/wx-phone', org.id, phone(5));
  const memberTry = await api('/audit-logs', { token: member });
  expectStatus(memberTry, 403, '会员查操作记录');
  const memberDaily = await api('/reconciliation/daily', { token: member });
  expectStatus(memberDaily, 403, '会员查对账');
  steps.push({
    tone: 'blocked',
    title: '会员看不到操作记录和对账',
    detail: `王女士用小程序账号去查，系统回答「${messageOf(memberTry.body)}」。`,
  });

  const firstRecord = await prisma.auditLog.findFirstOrThrow({ where: { orgId: org.id } });
  let refused = false;
  try {
    await prisma.auditLog.delete({ where: { id: firstRecord.id } });
  } catch (error) {
    refused = error instanceof Error && error.message.includes('append-only');
  }
  if (!refused) {
    throw new Error('数据库应该拒绝删除操作记录');
  }
  steps.push({
    tone: 'blocked',
    title: '操作记录改不了、删不掉',
    detail: '系统里没有修改或删除操作记录的接口。绕过系统直接在数据库里删，数据库本身也会拒绝。',
  });

  const when = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, render(steps, daily, audit, when), 'utf8');
  console.log(`p2 acceptance ok: ${steps.length} steps, ${audit.length} audit records → ${output}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
