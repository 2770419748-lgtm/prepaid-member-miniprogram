import { ApiError } from './errors';
import { formatClock } from './time';

/** 摄像头扫到的内容去掉空白。真正认不认是服务端的事。 */
export function cleanScanned(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/**
 * 扫码成功后去填消费金额。码和有效期带过去，提交时一起交给服务端。
 * 真机上 onLoad 拿到的参数不会自动解码，所以有效期用毫秒数传，整条地址里只有字母和数字。
 */
export function consumeEntryUrl(memberId: string, payCode: string, expiresAt: string): string {
  return `/pages/entry/entry?kind=CONSUME&memberId=${encodeURIComponent(memberId)}&payCode=${encodeURIComponent(payCode)}&until=${Date.parse(expiresAt)}`;
}

/** 记账页上显示的「18:25 前有效」。 */
export function validUntilText(expiresAt: string): string {
  return `${formatClock(expiresAt)} 前有效`;
}

/** 记账页地址里的 until（毫秒数）换成「18:25 前有效」；没带或读不出来就不显示。 */
export function untilText(until: string | undefined): string {
  const ms = Number(until);
  return until && Number.isFinite(ms) ? validUntilText(new Date(ms).toISOString()) : '';
}

/**
 * 消费没记上是不是因为会员码（过期、用过、不是这位会员的、不是你扫的）。
 * 是的话请顾客刷新会员码重新扫，金额不用重填。
 */
export function needsRescan(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    [400, 403, 409].includes(error.status) &&
    /会员码|扫码/.test(error.message) &&
    !/余额不足/.test(error.message)
  );
}
