import { keepLoginFresh as keepStaffLoginFresh } from './staff/utils/keep-login';
import { keepLoginFresh as keepMemberLoginFresh } from './utils/keep-login';

/**
 * 储值会员小程序：会员和员工共用这一个小程序（2026-11-04 合并）。
 * 第一页是登录页（pages/login/login），已登录的直接回到上次用的那一边：会员首页或工作台（staff/），见 utils/mode.ts。
 * 登录默认 30 天，每次回到前台时看一下要不要续期（会员、员工两张登录各续各的），常用就一直不用重新登录。
 * 充值和消费只在门店线下记账，这里没有任何支付能力。
 */
App({
  onShow() {
    keepMemberLoginFresh();
    keepStaffLoginFresh();
  },
});
