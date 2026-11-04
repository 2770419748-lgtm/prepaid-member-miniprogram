import { fetchAccount, fetchMe } from '../../utils/api';
import { maskPhone } from '../../utils/format';
import { hasStaffLogin, LOGIN_PAGE, openWorkbench, signOut } from '../../utils/mode';
import { errorText } from '../../utils/request';
import { clearSession, ensureLogin } from '../../utils/session';

/**
 * 「回到工作台」只给在职员工看：本机还留着员工登录（从工作台切过来的），点了直接回去；
 * 或者这个手机号刚开通了工作台（服务端说的），点了重新登录一次就进。普通会员看不到这一行。
 */
type WorkbenchEntry = '' | 'back' | 'relogin';

Page({
  data: {
    name: '',
    phoneText: '',
    initial: '会',
    workbench: '' as WorkbenchEntry,
  },

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    if (hasStaffLogin()) {
      this.setData({ workbench: 'back' });
    } else {
      fetchAccount()
        .then((account) => this.setData({ workbench: account.workbench ? 'relogin' : '' }))
        .catch(() => undefined);
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

  openWorkbench() {
    if (this.data.workbench === 'back') {
      openWorkbench();
      return;
    }
    if (this.data.workbench === 'relogin') {
      wx.showModal({
        title: '进入工作台',
        content: '您的手机号已开通工作台，用微信手机号重新登录一次就能进入。',
        confirmText: '重新登录',
        confirmColor: '#1677FF',
        success: (res) => {
          if (res.confirm) {
            clearSession();
            wx.reLaunch({ url: LOGIN_PAGE });
          }
        },
      });
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新用手机号登录。',
      confirmText: '退出',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          signOut();
        }
      },
    });
  },
});
