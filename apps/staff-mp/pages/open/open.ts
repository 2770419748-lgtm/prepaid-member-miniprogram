import { findMemberByPhone, openCard } from '../../utils/api';
import { ApiError, messageOf } from '../../utils/errors';
import { memberLabel } from '../../utils/ledger';
import { isMainlandMobile, normalizePhone } from '../../utils/phone';
import { currentStore, rememberMember, requireSession } from '../../utils/session';
import { formatDateTime } from '../../utils/time';

interface Done {
  memberId: string;
  label: string;
  storeName: string;
  time: string;
}

Page({
  data: {
    phone: '',
    name: '',
    phoneError: '',
    storeId: '',
    storeName: '',
    noStore: false,
    submitting: false,
    existingId: '',
    done: null as Done | null,
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ phone: query.phone ?? '' });
  },

  onShow() {
    const session = requireSession();
    if (!session) {
      return;
    }
    const store = currentStore(session);
    this.setData({
      storeId: store ? store.id : '',
      storeName: store ? store.name : '没有可用门店',
      noStore: !store,
    });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ phone: event.detail.value, phoneError: '', existingId: '' });
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting || this.data.noStore) {
      return;
    }
    const phone = normalizePhone(this.data.phone);
    if (!isMainlandMobile(phone)) {
      this.setData({ phoneError: '请输入 11 位手机号' });
      return;
    }
    const name = this.data.name.trim();
    this.setData({ submitting: true, phoneError: '', existingId: '' });
    try {
      const member = await openCard({ phone, storeId: this.data.storeId, ...(name ? { name } : {}) });
      rememberMember(member);
      this.setData({
        done: {
          memberId: member.id,
          label: memberLabel(member.phone, member.name),
          storeName: member.openStoreName ?? this.data.storeName,
          time: formatDateTime(member.openedAt ?? member.createdAt),
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 已经开过卡：查出这位会员，给一个直达入口。
        const existing = await findMemberByPhone(phone).catch(() => null);
        this.setData({ existingId: existing ? existing.id : '' });
        if (existing) {
          return;
        }
      }
      wx.showModal({ title: '没有开卡', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onViewExisting() {
    wx.redirectTo({ url: `/pages/member/member?id=${this.data.existingId}` });
  },

  onRecharge() {
    const done = this.data.done;
    if (done) {
      wx.redirectTo({ url: `/pages/entry/entry?memberId=${done.memberId}&kind=RECHARGE` });
    }
  },

  onHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
