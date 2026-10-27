import { BadRequestException } from '@nestjs/common';

/** 「当天」按上海时间算。上海不实行夏令时，固定 UTC+8。 */
export const BUSINESS_TIMEZONE = 'Asia/Shanghai';
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BusinessDay {
  /** YYYY-MM-DD */
  date: string;
  /** 当天 00:00（上海）对应的时刻，含。 */
  from: Date;
  /** 次日 00:00（上海）对应的时刻，不含。 */
  to: Date;
}

export function businessDate(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function businessDay(date: string | undefined, now = new Date()): BusinessDay {
  const day = date ?? businessDate(now);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new BadRequestException('日期格式应为 YYYY-MM-DD');
  }
  const midnightUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(midnightUtc).toISOString().slice(0, 10) !== day) {
    throw new BadRequestException('日期不存在');
  }
  const from = new Date(midnightUtc - OFFSET_MS);
  return { date: day, from, to: new Date(from.getTime() + DAY_MS) };
}
