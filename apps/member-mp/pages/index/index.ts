import { fetchBenefits, fetchLedger, fetchMe, fetchSignFlows, fetchStores, fetchWallet } from '../../utils/api';
import { clock, dayLabel, formatYuan, maskPhone } from '../../utils/format';
import { LedgerRow, toRow } from '../../utils/ledger';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';
import { BenefitSummary, GUIDED_KEY, guidedMark, homeBenefit, shouldGuide } from '../../utils/sign';

/** 储值规则（坤总已定）：全公司门店通用、长期有效用完为止、只在门店线下充值消费。还没有会员权益时首页显示它。 */
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
    benefit: null as BenefitSummary | null,
    /** 最近一份待签的权益单。 */
    pending: null as { id: string; title: string } | null,
    pendingCount: 0,
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
      const [me, wallet, stores, ledger, benefits, pending] = await Promise.all([
        fetchMe(),
        fetchWallet(),
        fetchStores(),
        fetchLedger({ page: 1, pageSize: 3 }),
        fetchBenefits(),
        fetchSignFlows({ page: 1, pageSize: 1, status: 'PENDING' }),
      ]);
      const first = pending.items[0];
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
        benefit: homeBenefit(benefits),
        pending: first ? { id: first.id, title: first.title } : null,
        pendingCount: pending.total,
      });
      if (first) {
        this.guide(first.id, now);
      }
    } catch (error) {
      // 已经显示过数据时只提示，不把页面清空。
      if (this.data.loading || this.data.error) {
        this.setData({ loading: false, error: errorText(error) });
      } else {
        wx.showToast({ title: errorText(error), icon: 'none' });
      }
    }
  },

  /** 设计规范：有没签的权益单，进首页先引导去签。每份每天只自动打开一次，其余时候看首页提醒条。 */
  guide(flowId: string, now: Date) {
    if (!shouldGuide(flowId, wx.getStorageSync(GUIDED_KEY), now)) {
      return;
    }
    wx.setStorageSync(GUIDED_KEY, guidedMark(flowId, now));
    this.openSignFlow(flowId);
  },

  openPending() {
    const pending = this.data.pending;
    if (!pending) {
      return;
    }
    if (this.data.pendingCount > 1) {
      wx.navigateTo({ url: '/pages/sign-list/sign-list' });
    } else {
      this.openSignFlow(pending.id);
    }
  },

  openSignFlow(id: string) {
    wx.navigateTo({ url: `/pages/sign/sign?id=${encodeURIComponent(id)}` });
  },

  openBenefits() {
    wx.navigateTo({ url: '/pages/benefits/benefits' });
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  /** 到店消费时出示会员码，门店扫码后才能扣款。 */
  openPayCode() {
    wx.navigateTo({ url: '/pages/paycode/paycode' });
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
