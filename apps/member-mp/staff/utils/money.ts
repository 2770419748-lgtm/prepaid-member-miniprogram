/**
 * 金额一律用整数分在程序里流转，只在输入和显示时换成元。
 * 不用浮点数做加减，避免 0.1 + 0.2 这类误差。
 */

/** 单笔上限 100 万元，与服务端 `MAX_AMOUNT_CENT` 一致，用来挡误录。 */
export const MAX_AMOUNT_CENT = 100_000_000;

export type ParsedAmount = { ok: true; cent: number } | { ok: false; reason: string };

/** 把店员输入的「元」换成分。最多两位小数，必须大于 0，不超过单笔上限。 */
export function parseYuanToCent(input: string): ParsedAmount {
  const text = input.trim();
  if (!text) {
    return { ok: false, reason: '请输入金额' };
  }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    return { ok: false, reason: '金额只能是数字' };
  }
  const [, intPart, fracPart = ''] = match;
  if (fracPart.length > 2) {
    return { ok: false, reason: '金额最多两位小数' };
  }
  const yuan = intPart.replace(/^0+(?=\d)/, '');
  if (yuan.length > 7) {
    return { ok: false, reason: '单笔不能超过 100 万元' };
  }
  const cent = Number(yuan) * 100 + Number(fracPart.padEnd(2, '0'));
  if (cent <= 0) {
    return { ok: false, reason: '金额要大于 0' };
  }
  if (cent > MAX_AMOUNT_CENT) {
    return { ok: false, reason: '单笔不能超过 100 万元' };
  }
  return { ok: true, cent };
}

/** 12345 → "123.45"，1234500 → "12,345.00"。负数带「-」。 */
export function formatCent(cent: number): string {
  const negative = cent < 0;
  const abs = Math.abs(Math.trunc(cent));
  const yuan = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fen = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${yuan}.${fen}`;
}

/** 余额变动带正负号：加为「+」，减为「-」。 */
export function formatChange(changeCent: number): string {
  return changeCent > 0 ? `+${formatCent(changeCent)}` : formatCent(changeCent);
}
