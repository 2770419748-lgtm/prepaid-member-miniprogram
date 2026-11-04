/**
 * 时间一律按北京时间显示和分组，不跟手机时区走，门店对账口径一致。
 */
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function beijing(iso: string | Date): Date {
  const time = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  return new Date(time + OFFSET_MS);
}

/** "2026-10-27" */
export function dayKey(iso: string | Date): string {
  const d = beijing(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "14:05" */
export function formatClock(iso: string): string {
  const d = beijing(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "2026-10-27 14:05:09" */
export function formatDateTime(iso: string): string {
  const d = beijing(iso);
  return `${dayKey(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 今天、昨天，其余显示「10月25日」，跨年加年份。 */
export function dayLabel(key: string, now: Date = new Date()): string {
  const today = dayKey(now);
  if (key === today) {
    return '今天';
  }
  if (key === dayKey(new Date(now.getTime() - DAY_MS))) {
    return '昨天';
  }
  const [year, month, day] = key.split('-');
  const label = `${Number(month)}月${Number(day)}日`;
  return year === today.slice(0, 4) ? label : `${year}年${label}`;
}

/** 北京时间 N 天前的零点（含今天，days=1 即今天零点），ISO 格式，用作查询起点。 */
export function startOfDaysAgo(days: number, now: Date = new Date()): string {
  const local = now.getTime() + OFFSET_MS;
  const midnight = local - (local % DAY_MS) - (days - 1) * DAY_MS;
  return new Date(midnight - OFFSET_MS).toISOString();
}
