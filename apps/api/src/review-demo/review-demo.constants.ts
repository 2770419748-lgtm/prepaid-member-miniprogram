import { randomInt } from 'crypto';

/**
 * 微信审核体验入口（上线清单 D）。
 *
 * 微信审核员没有本公司员工的手机号，进不了工作台。超级管理员提审前在商家后台打开入口，
 * 小程序登录页底部出现「审核体验入口」，审核员用这里的账号和后台给的密码登录，
 * 进的是一家单独的演示公司（假门店、假会员、假流水），碰不到真实数据。7 天后自动关闭，审完也可以手动关。
 */

/** 审核账号。填进微信提审表单的「测试账号」。密码每次打开时随机生成。 */
export const REVIEW_DEMO_ACCOUNT = 'shenhe';

/** 打开一次能用几天。 */
export const REVIEW_DEMO_DAYS = 7;

/** 演示公司里审核员的员工手机号（虚构号段，只在演示公司里有）。 */
export const REVIEW_STAFF_PHONE = '19900000000';

export const REVIEW_DEMO_ORG_NAME = '演示公司（仅供审核体验）';

/** 入口开着：设过截止时间且还没到。 */
export function reviewDemoOpen(until: Date | null | undefined, now: Date = new Date()): boolean {
  return !!until && until.getTime() > now.getTime();
}

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 10 位小写字母加数字，去掉 0/o、1/l/i 这些容易看错的，方便照着填进微信表单。 */
export function generateReviewPassword(): string {
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}
