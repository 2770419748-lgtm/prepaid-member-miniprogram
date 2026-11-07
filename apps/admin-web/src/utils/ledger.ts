import type { LedgerEntry, LedgerType } from '../api/types';
import { formatDateTime } from './datetime';
import { formatCent } from './money';
import { maskPhone } from './phone';

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REVERSAL: '冲正',
  REFUND: '退余额',
};

export const LEDGER_TYPE_OPTIONS = (Object.keys(LEDGER_TYPE_LABEL) as LedgerType[]).map((value) => ({
  value,
  label: LEDGER_TYPE_LABEL[value],
}));

/** 无码抵扣：顾客出示不了会员码，店长或超管按手机号直接抵扣（坤总 2026-11-07）。 */
export const CODELESS_LABEL = '无码抵扣';

/** 流水查询的「类型」筛选：四类之外再加「消费 · 无码抵扣」，查的是 type=CONSUME&codeless=true。 */
export type LedgerTypeFilter = LedgerType | 'CODELESS';

export const LEDGER_FILTER_OPTIONS: { value: LedgerTypeFilter; label: string }[] = [
  ...LEDGER_TYPE_OPTIONS.flatMap((option) =>
    option.value === 'CONSUME' ? [option, { value: 'CODELESS' as const, label: `消费 · ${CODELESS_LABEL}` }] : [option],
  ),
];

export function isLedgerTypeFilter(value: unknown): value is LedgerTypeFilter {
  return value === 'CODELESS' || (typeof value === 'string' && value in LEDGER_TYPE_LABEL);
}

/** 筛选换成接口参数。 */
export function typeFilterQuery(filter: LedgerTypeFilter | undefined): { type?: LedgerType; codeless?: 'true' } {
  if (!filter) {
    return {};
  }
  return filter === 'CODELESS' ? { type: 'CONSUME', codeless: 'true' } : { type: filter };
}

/** 消费最多抵商品应付金额的 10%，和服务端一致。 */
export const ORDER_OFFSET_PERCENT = 10;

/** 一张单最多抵 1000 元（坤总 2026-11-05），和服务端一致。 */
export const ORDER_OFFSET_MAX_CENT = 100_000;

/**
 * 九讯云订单号整理成和服务端一样的写法：A + 不以 0 开头的数字。
 * 小票上印「单号：5982」，条码里是「A5982」，两种都认。不是单号返回 null。
 */
export function normalizeOrderNo(input: string): string | null {
  const match = /^A?(\d{1,10})$/.exec(input.replace(/\s+/g, '').toUpperCase());
  const digits = match ? match[1].replace(/^0+/, '') : '';
  return digits ? `A${digits}` : null;
}

const CSV_COLUMNS: Array<[string, (entry: LedgerEntry) => string]> = [
  ['时间', (e) => formatDateTime(e.createdAt)],
  ['门店', (e) => e.storeName],
  ['类型', (e) => (e.type === 'REVERSAL' && e.reversalOfType ? `冲正（抵掉${LEDGER_TYPE_LABEL[e.reversalOfType]}）` : LEDGER_TYPE_LABEL[e.type])],
  ['办理方式', (e) => (e.type === 'CONSUME' ? (e.codeless ? CODELESS_LABEL : '扫码') : '')],
  ['九讯云订单', (e) => e.orderNo ?? ''],
  ['单号来源', (e) => (e.orderNoTyped == null ? '' : e.orderNoTyped ? '手输' : '扫码')],
  ['商品应付（元）', (e) => (e.productAmountCent == null ? '' : formatCent(e.productAmountCent).replace(/,/g, ''))],
  ['金额（元）', (e) => formatCent(e.changeCent).replace(/,/g, '')],
  ['变动后余额（元）', (e) => formatCent(e.balanceAfter).replace(/,/g, '')],
  ['已冲正', (e) => (e.reversedById ? '是' : '')],
  ['会员', (e) => e.memberName ?? ''],
  ['手机号', (e) => maskPhone(e.memberPhone)],
  ['操作人', (e) => e.operatorName ?? ''],
  ['备注', (e) => e.remark ?? ''],
  ['流水号', (e) => e.id],
];

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/** 一格：文字以 = + - @ 开头时前面加 '，免得表格软件当公式执行；带逗号、引号、换行的加引号。 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !NUMBER_PATTERN.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 流水导出成 CSV（给对账用，手机号打码）。开头不带 BOM，下载时再加。 */
export function ledgerCsv(entries: LedgerEntry[]): string {
  const lines = [CSV_COLUMNS.map(([title]) => title).join(',')];
  for (const entry of entries) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(entry))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
