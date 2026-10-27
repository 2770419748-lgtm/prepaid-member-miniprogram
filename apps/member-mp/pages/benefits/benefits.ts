import { fetchBenefits } from '../../utils/api';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';
import { BenefitCard, toBenefitCard } from '../../utils/sign';

/** 权益页只读：每个权益方案的内容和自己签没签。 */
Page({
  data: {
    loading: true,
    error: '',
    cards: [] as BenefitCard[],
  },

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    try {
      const benefits = await fetchBenefits();
      this.setData({ loading: false, error: '', cards: benefits.map(toBenefitCard) });
    } catch (error) {
      if (this.data.cards.length === 0) {
        this.setData({ loading: false, error: errorText(error) });
      } else {
        wx.showToast({ title: errorText(error), icon: 'none' });
      }
    }
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  openFlow(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) {
      wx.navigateTo({ url: `/pages/sign/sign?id=${encodeURIComponent(id)}` });
    }
  },

  openList() {
    wx.navigateTo({ url: '/pages/sign-list/sign-list' });
  },
});
