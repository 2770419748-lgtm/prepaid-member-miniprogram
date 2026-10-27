/** 分 → 「1,234.50」。整数运算，不经过浮点。 */
export function formatYuan(cent: number): string {
  const abs = Math.abs(Math.trunc(cent));
  const yuan = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fen = String(abs % 100).padStart(2, '0');
  return `${cent < 0 ? '-' : ''}${yuan}.${fen}`;
}

/** 带加减号的金额：加「+」，减「-」。 */
export function formatChange(cent: number): string {
  const sign = cent > 0 ? '+' : cent < 0 ? '-' : '';
  return `${sign}${formatYuan(Math.abs(cent))}`;
}

/** 手机号中间四位打码。 */
export function maskPhone(phone: string): string {
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/** 一律按北京时间显示，不随手机时区变。 */
function beijing(value: string | Date): Parts {
  const date = new Date(new Date(value).getTime() + BEIJING_OFFSET);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    weekday: date.getUTCDay(),
  };
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

export function dayKey(value: string | Date): string {
  const p = beijing(value);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** 「今天」「昨天」「10月25日 周六」，不是今年的带上年份。 */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) {
    return '今天';
  }
  if (key === dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) {
    return '昨天';
  }
  const p = beijing(value);
  const year = p.year === beijing(now).year ? '' : `${p.year}年`;
  return `${year}${p.month}月${p.day}日 ${WEEKDAYS[p.weekday]}`;
}

export function clock(value: string | Date): string {
  const p = beijing(value);
  return `${two(p.hour)}:${two(p.minute)}`;
}

export function dateTime(value: string | Date): string {
  const p = beijing(value);
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}
