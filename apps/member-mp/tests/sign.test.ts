import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemberBenefit, SignFlowView, SignStatus } from '../utils/api';
import {
  amountNote,
  guidedMark,
  homeBenefit,
  isSignUrl,
  ruleLines,
  shouldGuide,
  STATUS_TEXT,
  toBenefitCard,
  toSignDetail,
  toSignRow,
} from '../utils/sign';

function plan(overrides: Partial<MemberBenefit> = {}): MemberBenefit {
  return {
    id: 'plan-1',
    title: '储值会员权益',
    summary: '开卡即享',
    items: [
      { title: '全部门店通用', detail: '余额在每一家门店都能用' },
      { title: '长期有效', detail: null },
    ],
    rules: '1. 不可提现\n\n2. 以门店记账为准\n',
    signFlow: null,
    ...overrides,
  };
}

function flow(overrides: Partial<SignFlowView> = {}): SignFlowView {
  return {
    id: 'flow-1',
    title: '储值会员权益确认单',
    status: 'PENDING',
    env: 'SANDBOX',
    sandbox: true,
    benefitPlan: { id: 'plan-1', title: '储值会员权益', summary: null, items: [{ title: '全部门店通用', detail: null }], rules: '不可提现' },
    rechargeAmountCent: null,
    recharged: false,
    hasPdf: false,
    signedAt: null,
    // 北京时间 2026-10-27 18:30
    createdAt: '2026-10-27T10:30:00.000Z',
    updatedAt: '2026-10-27T10:30:00.000Z',
    ...overrides,
  };
}

const signed = (id = 'flow-1'): MemberBenefit['signFlow'] => ({ id, status: 'SIGNED', updatedAt: '2026-10-27T10:30:00.000Z' });

test('每个状态都有中文名', () => {
  const all: SignStatus[] = ['DRAFT', 'PENDING', 'SIGNED', 'REJECTED', 'EXPIRED', 'CANCELED'];
  for (const status of all) {
    assert.match(STATUS_TEXT[status], /[一-龥]/);
  }
});

test('规则按行拆开，去掉空行', () => {
  assert.deepEqual(ruleLines('1. 不可提现\n\n2. 以门店记账为准\r\n'), ['1. 不可提现', '2. 以门店记账为准']);
  assert.deepEqual(ruleLines(null), []);
});

test('首页权益：只摘前 3 条，签过的不带提示', () => {
  const items = ['一', '二', '三', '四'].map((title) => ({ title, detail: null }));
  const summary = homeBenefit([plan({ items, signFlow: signed() })]);
  assert.ok(summary);
  assert.equal(summary.items.length, 3);
  assert.equal(summary.more, true);
  assert.equal(summary.statusText, '已签署');
  assert.equal(summary.tone, 'ok');
  assert.equal(summary.hint, '');
});

test('首页权益：待签提示签署，没办过提示到店，没有权益回退储值说明', () => {
  const pending = homeBenefit([plan({ signFlow: { id: 'f', status: 'PENDING', updatedAt: '' } })]);
  assert.equal(pending?.statusText, '待签署');
  assert.equal(pending?.hint, '签署权益单后生效');

  const none = homeBenefit([plan()]);
  assert.equal(none?.statusText, '');
  assert.equal(none?.hint, '到门店办理后生效');

  const expired = homeBenefit([plan({ signFlow: { id: 'f', status: 'EXPIRED', updatedAt: '' } })]);
  assert.equal(expired?.statusText, '');
  assert.equal(expired?.hint, '到门店办理后生效');

  assert.equal(homeBenefit([]), null);
  assert.equal(homeBenefit([plan({ items: [] })]), null);
});

test('权益页：待签去签署，签过看权益单，撤销的当作没办过', () => {
  assert.equal(toBenefitCard(plan({ signFlow: { id: 'f', status: 'PENDING', updatedAt: '' } })).action, 'sign');
  const done = toBenefitCard(plan({ signFlow: signed('f2') }));
  assert.equal(done.action, 'view');
  assert.equal(done.flowId, 'f2');
  assert.equal(done.statusText, '已签署');
  assert.deepEqual(done.ruleLines, ['1. 不可提现', '2. 以门店记账为准']);

  const rejected = toBenefitCard(plan({ signFlow: { id: 'f3', status: 'REJECTED', updatedAt: '' } }));
  assert.equal(rejected.action, 'view');
  assert.equal(rejected.statusText, '已拒签');

  const canceled = toBenefitCard(plan({ signFlow: { id: 'f4', status: 'CANCELED', updatedAt: '' } }));
  assert.equal(canceled.action, 'none');
  assert.equal(canceled.flowId, '');
  assert.equal(canceled.statusText, '');
  assert.equal(toBenefitCard(plan()).action, 'none');
});

test('权益单列表：签过显示签署日期，没签显示发起日期（北京时间）', () => {
  assert.equal(toSignRow(flow()).dateText, '发起于 2026年10月27日');
  // UTC 10-27 16:30 = 北京时间 10-28 00:30
  assert.equal(toSignRow(flow({ status: 'SIGNED', signedAt: '2026-10-27T16:30:00.000Z' })).dateText, '签署于 2026年10月28日');
  assert.equal(toSignRow(flow()).sandbox, true);
});

test('签署页：待签可以签，签完有合同才给看', () => {
  const pending = toSignDetail(flow());
  assert.equal(pending.canSign, true);
  assert.equal(pending.note, '');
  assert.equal(pending.timeLabel, '发起时间');
  assert.equal(pending.timeText, '2026-10-27 18:30');
  assert.deepEqual(pending.ruleLines, ['不可提现']);

  const archived = toSignDetail(flow({ status: 'SIGNED', hasPdf: true, signedAt: '2026-10-27T11:00:00.000Z' }));
  assert.equal(archived.canSign, false);
  assert.equal(archived.hasPdf, true);
  assert.equal(archived.timeLabel, '签署时间');
  assert.equal(archived.note, '已签署，会员权益已生效。');

  const archiving = toSignDetail(flow({ status: 'SIGNED', hasPdf: false, signedAt: '2026-10-27T11:00:00.000Z' }));
  assert.equal(archiving.hasPdf, false);
  assert.match(archiving.note, /正在归档/);

  // 撤销后即使接口说有合同也不显示（只在已签署时显示）。
  assert.equal(toSignDetail(flow({ status: 'CANCELED', hasPdf: true })).hasPdf, false);
  assert.match(toSignDetail(flow({ status: 'REJECTED' })).note, /拒绝签署/);
  assert.match(toSignDetail(flow({ status: 'EXPIRED' })).note, /已过期/);
  assert.match(toSignDetail(flow({ status: 'CANCELED' })).note, /撤销/);
});

test('签署页：没有关联权益方案时不显示空卡片', () => {
  const detail = toSignDetail(flow({ benefitPlan: null }));
  assert.equal(detail.hasPlan, false);
  assert.deepEqual(detail.items, []);
  assert.deepEqual(detail.ruleLines, []);
});

test('未签先引导：同一份每天只自动打开一次，换了新的再引导', () => {
  const morning = new Date('2026-10-27T01:00:00.000Z'); // 北京时间 09:00
  const evening = new Date('2026-10-27T12:00:00.000Z'); // 北京时间 20:00
  const tomorrow = new Date('2026-10-27T17:00:00.000Z'); // 北京时间次日 01:00
  assert.equal(shouldGuide('f1', '', morning), true);
  const mark = guidedMark('f1', morning);
  assert.equal(shouldGuide('f1', mark, evening), false);
  assert.equal(shouldGuide('f2', mark, evening), true);
  assert.equal(shouldGuide('f1', mark, tomorrow), true);
});

test('签署页面只打开 https 链接', () => {
  assert.equal(isSignUrl('https://smlh5.esign.cn/sign/abc?t=1'), true);
  assert.equal(isSignUrl('http://example.com/'), false);
  assert.equal(isSignUrl('javascript:alert(1)'), false);
  assert.equal(isSignUrl(''), false);
});

test('会员权益金额：签之前说签署后充值，签完说已充值，没签成说没有充值', () => {
  assert.equal(toSignDetail(flow()).amountText, '');
  const pending = toSignDetail(flow({ rechargeAmountCent: 100000 }));
  assert.equal(pending.amountText, '1,000.00');
  assert.equal(pending.amountNote, '签署完成后充值到您的余额');
  assert.equal(amountNote({ status: 'SIGNED', recharged: true }), '已充值到您的余额');
  assert.equal(amountNote({ status: 'SIGNED', recharged: false }), '签署完成，正在充值到您的余额');
  for (const status of ['REJECTED', 'EXPIRED', 'CANCELED'] as SignStatus[]) {
    assert.match(amountNote({ status, recharged: false }), /没有充值/);
  }
});
