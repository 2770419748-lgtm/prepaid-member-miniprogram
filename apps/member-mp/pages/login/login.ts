import { fetchMyStores } from '../../staff/utils/api';
import { ApiError as StaffApiError, messageOf } from '../../staff/utils/errors';
import { clearSession as clearStaffSession, saveLogin as saveStaffLogin } from '../../staff/utils/session';
import type { StaffLoginResult } from '../../staff/utils/types';
import { fetchReviewDemo, loginReviewDemo, loginWithPhone, SignInResult } from '../../utils/api';
import { devMockPhone } from '../../utils/config';
import { currentLanding, MEMBER_HOME, openWorkbench, setMode } from '../../utils/mode';
import { errorText } from '../../utils/request';
import { clearSession as clearMemberSession, saveSession } from '../../utils/session';

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve(res.code),
      fail: () => reject(new Error('wx.login failed')),
    });
  });
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.message === 'wx.login failed') {
    return '微信登录失败，请重试';
  }
  return error instanceof StaffApiError ? messageOf(error) : errorText(error);
}

/**
 * 小程序的第一页。会员和员工共用这一个小程序：
 * - 已经登录过的，直接回到上次用的那一边（会员首页或工作台），这一页不露面；
 * - 没登录的点「手机号快捷登录」，在职员工的手机号直接进工作台，其他人进会员首页。
 * 页面上不出现任何工作台的字样；只有超级管理员在商家后台打开「审核体验」时，底部才有一个给微信审核员的小入口。
 */
Page({
  data: {
    ready: false,
    submitting: false,
    reviewEnabled: false,
    reviewOpen: false,
    account: '',
    password: '',
    reviewError: '',
    /** 按钮上方的一行提示：登录失效被送回来的原因，或者刚才登录没成功的原因。 */
    notice: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const landing = currentLanding();
    if (landing === 'staff') {
      openWorkbench();
      return;
    }
    if (landing === 'member') {
      setMode('member');
      wx.switchTab({ url: MEMBER_HOME });
      return;
    }
    // 换了手机号、被停用、改了密码等，旧登录失效后被送回这一页：说一声，不然像是莫名其妙退出了。
    this.setData({ ready: true, notice: query && query.expired === '1' ? '登录已失效，请重新登录' : '' });
    fetchReviewDemo()
      .then((enabled) => this.setData({ reviewEnabled: enabled }))
      .catch(() => undefined);
  },

  /** 「手机号快捷登录」：微信给一个手机号凭证，后端换成手机号，认出是员工还是会员。 */
  async onPhoneNumber(event: WechatMiniprogram.CustomEvent<{ code?: string; errMsg: string }>) {
    if (this.data.submitting) {
      return;
    }
    const mockPhone = devMockPhone();
    const phoneCode = event.detail.code;
    if (!phoneCode && !mockPhone) {
      wx.showToast({ title: '需要授权手机号才能登录', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, notice: '' });
    try {
      const code = await wxLoginCode();
      const result = await loginWithPhone({
        code,
        phoneCode: phoneCode || 'dev-mock',
        mockPhone: mockPhone ?? undefined,
      });
      await this.enter(result);
    } catch (error) {
      // 留在页面上（比如「会员卡已停用」），不只是一闪而过的提示。
      this.setData({ notice: failureText(error) });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 换了人登录：另一边的旧登录一起清掉，只留这次的。 */
  async enter(result: SignInResult) {
    if (result.principalType === 'STAFF') {
      await this.enterWorkbench(result);
      return;
    }
    clearStaffSession();
    saveSession(result.accessToken, result.expiresIn);
    setMode('member');
    wx.switchTab({ url: MEMBER_HOME });
  },

  async enterWorkbench(login: StaffLoginResult) {
    const access = await fetchMyStores(login.accessToken);
    clearMemberSession();
    saveStaffLogin(login, access);
    openWorkbench();
  },

  // ---- 审核体验入口（只在商家后台打开「审核体验」时显示） ----

  onOpenReview() {
    this.setData({ reviewOpen: !this.data.reviewOpen, reviewError: '' });
  },

  onAccountInput(event: WechatMiniprogram.Input) {
    this.setData({ account: event.detail.value, reviewError: '' });
  },

  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value, reviewError: '' });
  },

  async onReviewLogin() {
    if (this.data.submitting) {
      return;
    }
    const account = this.data.account.trim();
    const password = this.data.password;
    if (!account || !password) {
      this.setData({ reviewError: '请填写审核账号和密码' });
      return;
    }
    this.setData({ submitting: true, reviewError: '' });
    try {
      const login = await loginReviewDemo({ account, password });
      await this.enterWorkbench(login);
    } catch (error) {
      this.setData({ reviewError: failureText(error) });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
