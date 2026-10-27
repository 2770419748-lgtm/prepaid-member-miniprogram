import { fetchMe } from '../../utils/api';
import { maskPhone } from '../../utils/format';
import { errorText } from '../../utils/request';
import { clearSession, ensureLogin } from '../../utils/session';

Page({
  data: {
    name: '',
    phoneText: '',
    initial: '会',
  },

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    fetchMe()
      .then((me) => {
        this.setData({
          name: me.name ?? '储值会员',
          phoneText: maskPhone(me.phone),
          initial: me.name ? me.name.slice(0, 1) : '会',
        });
      })
      .catch((error) => wx.showToast({ title: errorText(error), icon: 'none' }));
  },

  openLedger() {
    wx.switchTab({ url: '/pages/ledger/ledger' });
  },

  openBenefits() {
    wx.navigateTo({ url: '/pages/benefits/benefits' });
  },

  openSignList() {
    wx.navigateTo({ url: '/pages/sign-list/sign-list' });
  },

  openStores() {
    wx.navigateTo({ url: '/pages/stores/stores' });
  },

  showRules() {
    wx.showModal({
      title: '储值说明',
      content: '余额在全部门店通用，长期有效，用完为止。充值和消费都在门店办理，小程序只做查询，不收款。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#1677FF',
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新用手机号登录。',
      confirmText: '退出',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          clearSession();
          wx.reLaunch({ url: '/pages/login/login' });
        }
      },
    });
  },
});
