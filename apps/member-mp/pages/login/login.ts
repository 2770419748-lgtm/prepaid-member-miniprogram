import { loginWithPhone } from '../../utils/api';
import { devMockPhone } from '../../utils/config';
import { errorText } from '../../utils/request';
import { currentToken, saveSession } from '../../utils/session';

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve(res.code),
      fail: () => reject(new Error('wx.login failed')),
    });
  });
}

Page({
  data: {
    submitting: false,
  },

  onLoad() {
    if (currentToken()) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  /** 「手机号快捷登录」：微信给一个手机号凭证，后端换成手机号并找到（或建好）会员。 */
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
    this.setData({ submitting: true });
    try {
      const code = await wxLoginCode();
      const result = await loginWithPhone({
        code,
        phoneCode: phoneCode || 'dev-mock',
        mockPhone: mockPhone ?? undefined,
      });
      saveSession(result.accessToken, result.expiresIn);
      wx.switchTab({ url: '/pages/index/index' });
    } catch (error) {
      wx.showToast({ title: error instanceof Error && error.message === 'wx.login failed' ? '微信登录失败，请重试' : errorText(error), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
