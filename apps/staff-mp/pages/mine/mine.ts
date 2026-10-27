import { fetchMyStores } from '../../utils/api';
import { ROLE_LABELS } from '../../utils/labels';
import { maskPhone } from '../../utils/phone';
import { clearSession, currentStore, LOGIN_PAGE, requireSession, saveAccess, Session } from '../../utils/session';

Page({
  data: {
    name: '',
    initial: '',
    phone: '',
    storeName: '',
    roleLabel: '',
    storeCount: '',
    canSwitch: false,
  },

  onShow() {
    const session = requireSession();
    if (!session) {
      return;
    }
    this.render(session);
    fetchMyStores()
      .then((access) => {
        const updated = saveAccess(access);
        if (updated) {
          this.render(updated);
        }
      })
      .catch(() => undefined);
  },

  render(session: Session) {
    const store = currentStore(session);
    const active = session.access.stores.filter((item) => item.status === 'ACTIVE');
    this.setData({
      name: session.staff.name,
      initial: session.staff.name.slice(0, 1),
      phone: maskPhone(session.staff.phone),
      storeName: store ? store.name : '没有可用门店',
      roleLabel: store ? ROLE_LABELS[store.role] : '—',
      storeCount: session.access.unrestricted ? `全部 ${active.length} 家` : `${active.length} 家`,
      canSwitch: active.length > 1,
    });
  },

  onSwitchStore() {
    if (this.data.canSwitch) {
      wx.navigateTo({ url: '/pages/stores/stores' });
    }
  },

  async onLogout() {
    const { confirm } = await wx.showModal({
      title: '退出登录',
      content: '退出后需要重新用微信手机号登录。',
      confirmText: '退出',
      confirmColor: '#DC2626',
    });
    if (confirm) {
      clearSession();
      wx.reLaunch({ url: LOGIN_PAGE });
    }
  },
});
