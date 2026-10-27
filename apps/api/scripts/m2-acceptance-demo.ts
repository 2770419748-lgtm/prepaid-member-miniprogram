import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PrismaClient, StaffRole } from '@prisma/client';

/**
 * M2 账本验收演示。对着正在运行的本地服务一步步操作，把真实结果写成一页 HTML。
 * 需要本地服务以 WECHAT_PHONE_MOCK=true 启动（只在开发环境生效），用假手机号登录。
 *
 *   API_BASE=http://127.0.0.1:3000 pnpm --filter api exec tsx scripts/m2-acceptance-demo.ts
 */

const prisma = new PrismaClient();
const base = (process.env.API_BASE ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const output = process.env.ACCEPTANCE_HTML ?? join(tmpdir(), 'm2-acceptance.html');

interface ApiResult {
  status: number;
  body: unknown;
}

interface Step {
  title: string;
  detail: string;
  tone: 'ok' | 'blocked';
}

interface MoveBody {
  balanceCent: number;
  replayed: boolean;
  entry: { id: string };
}

interface StaffEntry {
  id: string;
  type: 'RECHARGE' | 'CONSUME' | 'REVERSAL';
  changeCent: number;
  balanceAfter: number;
  storeName: string;
  operatorName: string | null;
  remark: string | null;
  reversedById: string | null;
  createdAt: string;
}

const typeLabel: Record<StaffEntry['type'], string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REVERSAL: '冲正',
};

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

function render(steps: Step[], entries: StaffEntry[], when: string): string {
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
  const rows = [...entries]
    .reverse()
    .map((entry) => {
      const time = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(entry.createdAt));
      const note = [entry.remark, entry.reversedById ? '已被冲正' : null].filter(Boolean).join('，');
      return `<tr>
        <td>${esc(time)}</td>
        <td>${esc(typeLabel[entry.type])}</td>
        <td class="num ${entry.changeCent < 0 ? 'minus' : 'plus'}">${entry.changeCent > 0 ? '+' : ''}${yuan(entry.changeCent)}</td>
        <td class="num">${yuan(entry.balanceAfter)}</td>
        <td>${esc(entry.storeName)}</td>
        <td>${esc(entry.operatorName ?? '')}</td>
        <td>${esc(note)}</td>
      </tr>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>储值账本验收</title>
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
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.plus { color: #1677ff; }
    td.minus { color: #1f2329; }
    footer { margin-top: 28px; color: #646a73; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>储值账本验收</h1>
    <p class="lead">开卡、线下充值、消费扣款、记错冲正、查明细。金额按分记，余额全公司门店通用，每一笔变动都留下一条删不掉的流水。</p>
    <p class="meta">验收时间：${esc(when)}。下面每一步都是刚刚对着运行中的服务真实操作的结果，不是手写示例。</p>
    ${cards}
    <h3>王女士这张卡的完整流水（商家后台视角）</h3>
    <table>
      <thead><tr><th>时间</th><th>类型</th><th class="num">变动（元）</th><th class="num">余额（元）</th><th>门店</th><th>操作人</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>
      只记账，不收款：没有接微信支付，充值的钱在门店线下收。电子签正式开关保持关闭。<br />
      第一版规则：储值终身有效、用完为止；不做赠送金；冲正只能由超管或原门店店长操作，一笔只能冲一次。
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
  const phone = (n: number) => `139${tail}000${String(n)}`;
  const org = await prisma.org.create({ data: { name: `账本验收${stamp}`, status: 'ACTIVE' } });
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
  const managerB = await login('/auth/staff/wx-phone', org.id, phone(3));
  const clerkB = await login('/auth/staff/wx-phone', org.id, phone(4));
  const superToken = await login('/auth/staff/wx-phone', org.id, phone(6));
  const memberPhone = phone(5);

  const opened = await api('/members/open', {
    token: clerkA,
    body: { phone: memberPhone, name: '王女士', storeId: flagship.id },
  });
  expectStatus(opened, 201, '开卡');
  const memberId = (opened.body as { id: string }).id;
  steps.push({
    tone: 'ok',
    title: '李店员在旗舰店给王女士开卡',
    detail: `登记手机号 ${memberPhone}，系统同时开好一张余额 ${yuan((opened.body as { balanceCent: number }).balanceCent)} 元的卡。`,
  });

  const twice = await api('/members/open', {
    token: clerkB,
    body: { phone: memberPhone, storeId: community.id },
  });
  expectStatus(twice, 409, '重复开卡');
  steps.push({
    tone: 'blocked',
    title: '同一个手机号不能开第二张卡',
    detail: `周店员在社区店又给这个号开卡，系统回答「${messageOf(twice.body)}」。`,
  });

  const member = await login('/auth/member/wx-phone', org.id, memberPhone);
  /** 王女士在小程序里出示会员码，店员用手机扫。返回扫到的码，扣款时带上。 */
  async function showAndScan(staffToken: string, storeId: string): Promise<string> {
    const issued = await api('/members/me/pay-code', { method: 'POST', token: member });
    expectStatus(issued, 201, '出示会员码');
    const code = (issued.body as { code: string }).code;
    expectStatus(await api('/pay-codes/scan', { token: staffToken, body: { code, storeId } }), 200, '扫会员码');
    return code;
  }

  const recharge = await api(`/wallets/${memberId}/recharge`, {
    token: clerkA,
    body: { storeId: flagship.id, amountCent: 10000, remark: '现金', requestId: randomUUID() },
  });
  expectStatus(recharge, 201, '充值');
  steps.push({
    tone: 'ok',
    title: '王女士在旗舰店充值 100.00 元',
    detail: `钱在店里线下收，系统只记账。余额变成 ${yuan((recharge.body as MoveBody).balanceCent)} 元。`,
  });

  const unscanned = await api(`/wallets/${memberId}/consume`, {
    token: clerkA,
    body: { storeId: flagship.id, amountCent: 3000, requestId: randomUUID() },
  });
  expectStatus(unscanned, 400, '没扫码扣款');
  steps.push({
    tone: 'blocked',
    title: '不扫会员码扣不了款',
    detail: `李店员没扫王女士的会员码就想扣 30.00 元，系统回答「${messageOf(unscanned.body)}」。`,
  });

  const spend = await api(`/wallets/${memberId}/consume`, {
    token: clerkA,
    body: {
      storeId: flagship.id,
      amountCent: 3000,
      requestId: randomUUID(),
      payCode: await showAndScan(clerkA, flagship.id),
    },
  });
  expectStatus(spend, 201, '消费');
  steps.push({
    tone: 'ok',
    title: '王女士出示会员码，李店员扫码后扣 30.00 元',
    detail: `余额变成 ${yuan((spend.body as MoveBody).balanceCent)} 元。`,
  });

  const elsewhere = await api(`/wallets/${memberId}/consume`, {
    token: clerkB,
    body: {
      storeId: community.id,
      amountCent: 2000,
      requestId: randomUUID(),
      payCode: await showAndScan(clerkB, community.id),
    },
  });
  expectStatus(elsewhere, 201, '跨店消费');
  steps.push({
    tone: 'ok',
    title: '到社区店也能用：消费 20.00 元',
    detail: `余额全公司通用，在旗舰店开的卡在社区店照样扣。余额变成 ${yuan((elsewhere.body as MoveBody).balanceCent)} 元。`,
  });

  const tooMuch = await api(`/wallets/${memberId}/consume`, {
    token: clerkB,
    body: {
      storeId: community.id,
      amountCent: 8000,
      requestId: randomUUID(),
      payCode: await showAndScan(clerkB, community.id),
    },
  });
  expectStatus(tooMuch, 400, '余额不足');
  steps.push({
    tone: 'blocked',
    title: '余额不够时扣不了',
    detail: `余额只有 50.00 元，想扣 80.00 元，系统回答「${messageOf(tooMuch.body)}」，账上什么也没动。`,
  });

  const codeAtA = await showAndScan(clerkA, flagship.id);
  const codeAtB = await showAndScan(clerkB, community.id);
  const race = await Promise.all([
    api(`/wallets/${memberId}/consume`, {
      token: clerkA,
      body: { storeId: flagship.id, amountCent: 4000, requestId: randomUUID(), payCode: codeAtA },
    }),
    api(`/wallets/${memberId}/consume`, {
      token: clerkB,
      body: { storeId: community.id, amountCent: 4000, requestId: randomUUID(), payCode: codeAtB },
    }),
  ]);
  const winners = race.filter((result) => result.status === 201);
  const loser = race.find((result) => result.status !== 201);
  if (winners.length !== 1 || !loser) {
    throw new Error(`同时扣款应该只有一笔成功，实际 ${race.map((result) => result.status).join('、')}`);
  }
  const afterRace = await prisma.wallet.findUniqueOrThrow({ where: { memberId } });
  if (afterRace.balanceCent !== 1000) {
    throw new Error(`同时扣款后余额应为 1000 分，实际 ${afterRace.balanceCent}`);
  }
  steps.push({
    tone: 'blocked',
    title: '两家店同一瞬间各扣 40.00 元，只成功一笔',
    detail: `余额 50.00 元，旗舰店和社区店同时各扣 40.00 元。一笔成功，另一笔被拒绝「${messageOf(loser.body)}」。余额 ${yuan(afterRace.balanceCent)} 元，不会扣成负数。`,
  });

  const wrong = await api(`/wallets/${memberId}/recharge`, {
    token: clerkA,
    body: { storeId: flagship.id, amountCent: 100000, remark: '充值', requestId: randomUUID() },
  });
  expectStatus(wrong, 201, '误录充值');
  const wrongId = (wrong.body as MoveBody).entry.id;
  steps.push({
    tone: 'ok',
    title: '李店员把 100 元误录成了 1000 元',
    detail: `余额一下变成 ${yuan((wrong.body as MoveBody).balanceCent)} 元。这条记录不能删也不能改，只能冲正。`,
  });

  const clerkTries = await api(`/ledger/${wrongId}/reversal`, { token: clerkA, body: { remark: '录错了' } });
  expectStatus(clerkTries, 403, '店员冲正');
  const otherManagerTries = await api(`/ledger/${wrongId}/reversal`, { token: managerB, body: { remark: '录错了' } });
  expectStatus(otherManagerTries, 403, '别店店长冲正');
  steps.push({
    tone: 'blocked',
    title: '店员和别家店长都冲不了',
    detail: `李店员自己冲正，系统回答「${messageOf(clerkTries.body)}」。社区店的赵店长来冲，也被拒绝。`,
  });

  const fixed = await api(`/ledger/${wrongId}/reversal`, {
    token: managerA,
    body: { remark: '多打了一个零', requestId: randomUUID() },
  });
  expectStatus(fixed, 201, '店长冲正');
  steps.push({
    tone: 'ok',
    title: '旗舰店张店长冲正这笔错账',
    detail: `补记一笔反方向的 1000.00 元把它抵掉，原因写「多打了一个零」。余额回到 ${yuan((fixed.body as MoveBody).balanceCent)} 元。原来那条还在，标着「已被冲正」。`,
  });

  const again = await api(`/ledger/${wrongId}/reversal`, { token: managerA, body: { remark: '再冲一次' } });
  expectStatus(again, 409, '重复冲正');
  steps.push({
    tone: 'blocked',
    title: '同一笔不能冲两次',
    detail: `张店长再冲一次，系统回答「${messageOf(again.body)}」。`,
  });

  const requestId = randomUUID();
  const first = await api(`/wallets/${memberId}/recharge`, {
    token: clerkA,
    body: { storeId: flagship.id, amountCent: 10000, remark: '充值', requestId },
  });
  const retry = await api(`/wallets/${memberId}/recharge`, {
    token: clerkA,
    body: { storeId: flagship.id, amountCent: 10000, remark: '充值', requestId },
  });
  expectStatus(first, 201, '正确充值');
  expectStatus(retry, 201, '网络重试');
  if (!(retry.body as MoveBody).replayed || (retry.body as MoveBody).entry.id !== (first.body as MoveBody).entry.id) {
    throw new Error('重复提交应该返回第一次的结果');
  }
  steps.push({
    tone: 'ok',
    title: '重新录对 100.00 元；网络卡了点了两次也只记一笔',
    detail: `同一次「确认」带着同一个请求号，第二次提交系统直接返回第一次的结果。余额 ${yuan((retry.body as MoveBody).balanceCent)} 元。`,
  });

  const wallet = await api('/members/me/wallet', { token: member });
  expectStatus(wallet, 200, '会员查余额');
  const mine = await api('/ledger', { token: member });
  expectStatus(mine, 200, '会员查明细');
  const mineItems = (mine.body as { items: Record<string, unknown>[] }).items;
  if (mineItems.some((item) => 'operatorName' in item || 'remark' in item)) {
    throw new Error('会员明细里不应出现店员和备注');
  }
  steps.push({
    tone: 'ok',
    title: '王女士在小程序里看到自己的余额和明细',
    detail: `余额 ${yuan((wallet.body as { balanceCent: number }).balanceCent)} 元，明细 ${mineItems.length} 条，每条有门店、金额和变动后余额。看不到操作店员的名字，也看不到店内备注。`,
  });

  const peek = await api('/staff', { token: member });
  expectStatus(peek, 403, '会员查员工');
  steps.push({
    tone: 'blocked',
    title: '会员看不到任何员工功能',
    detail: `会员账号去查员工列表，系统回答「${messageOf(peek.body)}」。`,
  });

  const seenByB = await api(`/ledger?memberId=${memberId}`, { token: clerkB });
  expectStatus(seenByB, 200, '社区店员查流水');
  const bItems = (seenByB.body as { items: StaffEntry[] }).items;
  if (bItems.some((item) => item.storeName !== '社区店')) {
    throw new Error('社区店员不应看到旗舰店的流水');
  }
  steps.push({
    tone: 'ok',
    title: '社区店员只看得到在社区店发生的流水',
    detail: `周店员查王女士的流水，只看到社区店的 ${bItems.length} 条；余额仍显示全公司总余额。超管能看全部。`,
  });

  let dbRefused = '';
  try {
    await prisma.ledgerEntry.delete({ where: { id: wrongId } });
  } catch (error) {
    dbRefused = error instanceof Error && error.message.includes('append-only') ? '数据库拒绝了删除' : '';
  }
  if (!dbRefused) {
    throw new Error('数据库应该拒绝删除流水');
  }
  steps.push({
    tone: 'blocked',
    title: '就算直接操作数据库，也删不掉流水',
    detail: '系统里没有删除流水的按钮或接口。绕过系统直接在数据库里删那条错账，数据库本身也会拒绝。',
  });

  const all = await prisma.ledgerEntry.count({ where: { memberId } });
  const superView = await api(`/ledger?memberId=${memberId}&pageSize=100`, { token: superToken });
  expectStatus(superView, 200, '超管查流水');
  const full = (superView.body as { items: StaffEntry[] }).items;
  if (full.length !== all) {
    throw new Error(`超管应看到全部 ${all} 条流水，实际 ${full.length}`);
  }

  const when = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, render(steps, full, when), 'utf8');
  console.log(`m2 acceptance ok: ${steps.length} steps, ${full.length} entries → ${output}`);
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
