import { fetchMyStores, findMemberByPhone } from '../../utils/api';
import { messageOf } from '../../utils/errors';
import { ROLE_LABELS } from '../../utils/labels';
import { memberLabel } from '../../utils/ledger';
import { isMainlandMobile, maskPhone, normalizePhone } from '../../utils/phone';
import {
  currentStore,
  recentMembers,
  rememberMember,
  requireSession,
  saveAccess,
  Session,
} from '../../utils/session';

/** 查不到卡时的提示，下面跟一个「为这个手机号开卡」。 */
interface SearchResult {
  phone: string;
  text: string;
}

Page({
  data: {
    storeName: '',
    roleLabel: '',
    canSwitch: false,
    noStore: false,
    phone: '',
    phoneError: '',
    searching: false,
    result: null as SearchResult | null,
    recent: [] as { id: string; label: string }[],
  },

  onShow() {
    const session = requireSession();
    if (!session) {
      return;
    }
    this.render(session);
    // 门店可能被停用或调整过角色，回到工作台时顺手刷新，失败不打扰。
    fetchMyStores()
      .then((access) => {
        const updated = saveAccess(access);
        if (updated) {
          this.render(updated);
        }
      })
      .catch(() => undefined);
  },

  onHide() {
    this.setData({ phone: '', phoneError: '', result: null });
  },

  render(session: Session) {
    const store = currentStore(session);
    const activeCount = session.access.stores.filter((item) => item.status === 'ACTIVE').length;
    this.setData({
      storeName: store ? store.name : '没有可用门店',
      roleLabel: store ? ROLE_LABELS[store.role] : '',
      canSwitch: activeCount > 1,
      noStore: !store,
      recent: recentMembers().map((item) => ({ id: item.id, label: memberLabel(item.phone, item.name) })),
    });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ phone: event.detail.value, phoneError: '', result: null });
  },

  async onSearch() {
    if (this.data.searching) {
      return;
    }
    const phone = normalizePhone(this.data.phone);
    if (!isMainlandMobile(phone)) {
      this.setData({ phoneError: '请输入 11 位手机号' });
      return;
    }
    this.setData({ searching: true, phoneError: '', result: null });
    try {
      const member = await findMemberByPhone(phone);
      if (member && member.hasCard) {
        rememberMember(member);
        wx.navigateTo({ url: `/pages/member/member?id=${member.id}` });
        return;
      }
      const text = member
        ? `${maskPhone(phone)} 在会员小程序登录过，但还没开卡。`
        : `没有找到 ${maskPhone(phone)} 的会员卡。`;
      this.setData({ result: { phone, text } });
    } catch (error) {
      this.setData({ phoneError: messageOf(error) });
    } finally {
      this.setData({ searching: false });
    }
  },

  onOpenForResult() {
    const result = this.data.result;
    if (result) {
      wx.navigateTo({ url: `/pages/open/open?phone=${result.phone}` });
    }
  },

  onOpenCard() {
    wx.navigateTo({ url: '/pages/open/open' });
  },

  onSwitchStore() {
    if (this.data.canSwitch) {
      wx.navigateTo({ url: '/pages/stores/stores' });
    }
  },

  onRecent(event: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    wx.navigateTo({ url: `/pages/member/member?id=${event.currentTarget.dataset.id}` });
  },
});
