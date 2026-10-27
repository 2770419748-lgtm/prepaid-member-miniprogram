import dayjs from 'dayjs';

/** 业务按北京时间算一天。 */
const SHANGHAI_OFFSET = '+08:00';

export function formatDateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '';
}

export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('YYYY-MM-DD') : '';
}

/** 某天 0 点（北京时间），ISO 格式，给接口的 from 用。 */
export function dayStart(date: string): string {
  return `${date}T00:00:00${SHANGHAI_OFFSET}`;
}

/** 某天的下一天 0 点（北京时间），给接口的 to 用（不含）。 */
export function nextDayStart(date: string): string {
  return `${dayjs(date).add(1, 'day').format('YYYY-MM-DD')}T00:00:00${SHANGHAI_OFFSET}`;
}
