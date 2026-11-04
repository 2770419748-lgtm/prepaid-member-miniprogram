import { signOut } from '../../../utils/mode';
import { fetchMyStores } from '../../utils/api';
import { messageOf } from '../../utils/errors';
import { ROLE_LABELS } from '../../utils/labels';
import { switchToMyMemberCard } from '../../utils/my-card';
import { maskPhone } from '../../utils/phone';
import { currentStore, requireSession, saveAccess, Session } from '../../utils/session';
import { hideHomeButton, StaffTab, switchStaffTab } from '../../utils/nav';

Page({
  data: {
    name: '',
    initial: '',
    phone: '',
    storeName: '',
    roleLabel: '',
    storeCount: '',
    canSwitch: false,
    switching: false,
  },

  onShow() {
    hideHomeButton();
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
      wx.navigateTo({ url: '/staff/pages/stores/stores' });
    }
  },

  /** 切到自己的会员卡（会员首页），员工登录留着，会员页「我的」里点「回到工作台」就回来。 */
  async onMyCard() {
    if (this.data.switching) {
      return;
    }
    this.setData({ switching: true });
    try {
      await switchToMyMemberCard();
    } catch (error) {
      wx.showToast({ title: messageOf(error), icon: 'none' });
    } finally {
      this.setData({ switching: false });
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
      signOut();
    }
  },

  onTab(event: WechatMiniprogram.BaseEvent<Record<string, never>, { tab: StaffTab }>) {
    switchStaffTab(event.currentTarget.dataset.tab);
  },
});
