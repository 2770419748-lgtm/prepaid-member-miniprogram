import { fetchLedger, fetchMe, fetchStores, fetchWallet } from '../../utils/api';
import { clock, dayLabel, formatYuan, maskPhone } from '../../utils/format';
import { LedgerRow, toRow } from '../../utils/ledger';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';

/** 储值规则（坤总已定）：全公司门店通用、长期有效用完为止、只在门店线下充值消费。 */
const RULES = [
  { title: '全部门店通用', detail: '余额在每一家门店都能用' },
  { title: '长期有效', detail: '储值不过期，用完为止' },
  { title: '到店充值和消费', detail: '小程序只查询，不收款' },
];

Page({
  data: {
    loading: true,
    error: '',
    greeting: '您好',
    phoneText: '',
    hasCard: false,
    disabled: false,
    balanceText: '0.00',
    updatedText: '',
    storeCount: 0,
    recent: [] as LedgerRow[],
    rules: RULES,
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
      const [me, wallet, stores, ledger] = await Promise.all([
        fetchMe(),
        fetchWallet(),
        fetchStores(),
        fetchLedger({ page: 1, pageSize: 3 }),
      ]);
      const now = new Date();
      this.setData({
        loading: false,
        error: '',
        greeting: me.name ? `您好，${me.name}` : '您好',
        phoneText: maskPhone(me.phone),
        hasCard: wallet.hasCard,
        disabled: me.status === 'DISABLED',
        balanceText: formatYuan(wallet.balanceCent),
        updatedText: wallet.updatedAt ? `${dayLabel(wallet.updatedAt, now)} ${clock(wallet.updatedAt)}` : '',
        storeCount: stores.length,
        recent: ledger.items.map((item) => toRow(item, now)),
      });
    } catch (error) {
      // 已经显示过数据时只提示，不把页面清空。
      if (this.data.loading || this.data.error) {
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

  openStores() {
    wx.navigateTo({ url: '/pages/stores/stores' });
  },

  openLedger() {
    wx.switchTab({ url: '/pages/ledger/ledger' });
  },

  openEntry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) {
      wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${encodeURIComponent(id)}` });
    }
  },
});
