/**
 * 金额一律用整数分在前后端之间传。页面上输入和显示用元，换算只在这里做。
 * 输入按字符串解析，不经过浮点数，避免 0.1 + 0.2 之类的误差。
 */

/** 单笔金额上限：100 万元，和后端一致。 */
export const MAX_AMOUNT_CENT = 100_000_000;

const YUAN_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** 把输入的元（如 "100"、"88.5"、"0.01"）换成分。格式不对返回 null。 */
export function yuanToCent(input: string): number | null {
  const text = input.trim().replace(/,/g, '');
  const match = YUAN_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const yuan = Number(match[1]);
  const fen = Number((match[2] ?? '').padEnd(2, '0'));
  return yuan * 100 + fen;
}

/** 校验一笔记账金额，返回给店员看的提示；没问题返回 null。 */
export function amountError(input: string): string | null {
  if (!input.trim()) {
    return '请输入金额';
  }
  const cent = yuanToCent(input);
  if (cent === null) {
    return '金额格式不对，最多两位小数，例如 100 或 88.50';
  }
  if (cent < 1) {
    return '金额至少 0.01 元';
  }
  if (cent > MAX_AMOUNT_CENT) {
    return '单笔不能超过 100 万元';
  }
  return null;
}

/** 分 → "1,234.50"。不带符号和货币单位。 */
export function formatCent(cent: number): string {
  const negative = cent < 0;
  const abs = Math.abs(cent);
  const yuan = Math.floor(abs / 100).toLocaleString('en-US');
  const fen = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${yuan}.${fen}`;
}

/** 分 → "¥1,234.50"。 */
export function formatYuan(cent: number): string {
  const text = formatCent(cent);
  return text.startsWith('-') ? `-¥${text.slice(1)}` : `¥${text}`;
}

/** 余额变动 → "+100.00" / "-30.00"。加为正，减为负。 */
export function formatChange(cent: number): string {
  if (cent > 0) {
    return `+${formatCent(cent)}`;
  }
  return formatCent(cent);
}
