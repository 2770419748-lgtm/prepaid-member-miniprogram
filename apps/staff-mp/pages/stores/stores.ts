import { ROLE_LABELS } from '../../utils/labels';
import { currentStore, requireSession, switchStore } from '../../utils/session';

interface StoreItem {
  id: string;
  name: string;
  sub: string;
  current: boolean;
  disabled: boolean;
}

Page({
  data: {
    stores: [] as StoreItem[],
  },

  onShow() {
    const session = requireSession();
    if (!session) {
      return;
    }
    const current = currentStore(session);
    this.setData({
      stores: session.access.stores.map((store) => ({
        id: store.id,
        name: store.name,
        sub: [ROLE_LABELS[store.role], store.address].filter(Boolean).join(' · '),
        current: current != null && current.id === store.id,
        disabled: store.status !== 'ACTIVE',
      })),
    });
  },

  onPick(event: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string; disabled: boolean }>) {
    const { id, disabled } = event.currentTarget.dataset;
    if (disabled) {
      wx.showToast({ title: '这家门店已停用', icon: 'none' });
      return;
    }
    switchStore(id);
    wx.navigateBack();
  },
});
