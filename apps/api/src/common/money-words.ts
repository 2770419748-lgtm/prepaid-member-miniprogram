/** 合同里写金额用：阿拉伯数字（带千分位）和人民币大写。金额单位都是分。 */

const DIGITS = '零壹贰叁肆伍陆柒捌玖';
const UNITS = ['仟', '佰', '拾', ''];
const SECTIONS = ['', '万', '亿', '万亿'];

/** 100000 → "1,000.00"。 */
export function formatYuan(cent: number): string {
  const yuan = Math.floor(cent / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${yuan}.${(cent % 100).toString().padStart(2, '0')}`;
}

/** 0–9999 写成大写，中间的零只写一个，末尾的零不写。 */
function fourDigits(value: number): string {
  let text = '';
  let zero = false;
  [Math.floor(value / 1000), Math.floor(value / 100) % 10, Math.floor(value / 10) % 10, value % 10].forEach(
    (digit, index) => {
      if (digit === 0) {
        zero = text !== '';
        return;
      }
      if (zero) {
        text += '零';
        zero = false;
      }
      text += DIGITS[digit] + UNITS[index];
    },
  );
  return text;
}

/**
 * 人民币大写，按《支付结算办法》的写法：到元为止写「整」，有角没分不写「整」，有分不写「整」。
 * 100000 → "壹仟元整"，1000500 → "壹万零伍元整"，105 → "壹元零伍分"。
 */
export function yuanInWords(cent: number): string {
  if (!Number.isInteger(cent) || cent < 0) {
    throw new RangeError('金额要是不小于 0 的整数分');
  }
  const yuan = Math.floor(cent / 100);
  const jiao = Math.floor(cent / 10) % 10;
  const fen = cent % 10;
  const groups: number[] = [];
  for (let rest = yuan; rest > 0; rest = Math.floor(rest / 10000)) {
    groups.push(rest % 10000);
  }
  let whole = '';
  let gap = false;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    if (group === 0) {
      gap = whole !== '';
      continue;
    }
    if (gap || (whole !== '' && group < 1000)) {
      whole += '零';
    }
    whole += fourDigits(group) + SECTIONS[i];
    gap = false;
  }
  if (jiao === 0 && fen === 0) {
    return `${whole || '零'}元整`;
  }
  let text = whole ? `${whole}元` : '';
  if (jiao > 0) {
    text += `${DIGITS[jiao]}角`;
  } else if (whole) {
    text += '零';
  }
  if (fen > 0) {
    text += `${DIGITS[fen]}分`;
  }
  return text;
}
