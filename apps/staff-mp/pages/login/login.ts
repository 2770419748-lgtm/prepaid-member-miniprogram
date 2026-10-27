import { fetchMyStores, loginWithWechatPhone } from '../../utils/api';
import { devMockPhone } from '../../utils/env';
import { ApiError, messageOf } from '../../utils/errors';
import { loadSession, saveLogin } from '../../utils/session';

const HOME = '/pages/index/index';

function loginFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return '这个手机号还没有开通店员账号，请联系店长或管理员开通。';
  }
  if (error instanceof ApiError && error.status === 403) {
    return '你的店员账号已停用，请联系管理员。';
  }
  return messageOf(error);
}

Page({
  data: {
    submitting: false,
    error: '',
  },

  onLoad() {
    if (loadSession()) {
      wx.switchTab({ url: HOME });
    }
  },

  async onGetPhoneNumber(event: WechatMiniprogram.ButtonGetPhoneNumber) {
    if (this.data.submitting) {
      return;
    }
    const phoneCode = event.detail.code;
    if (!phoneCode) {
      this.setData({ error: '需要授权手机号才能登录。请再点一次，并选择「允许」。' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const { code } = await wx.login();
      const mockPhone = devMockPhone();
      const login = await loginWithWechatPhone({ code, phoneCode, ...(mockPhone ? { mockPhone } : {}) });
      const access = await fetchMyStores(login.accessToken);
      saveLogin(login, access);
      wx.switchTab({ url: HOME });
    } catch (error) {
      this.setData({ error: loginFailure(error) });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
