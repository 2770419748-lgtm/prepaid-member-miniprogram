import { fetchLedger, LedgerItem, LedgerType } from '../../utils/api';
import { groupByDay, LedgerGroup } from '../../utils/ledger';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';

const PAGE_SIZE = 20;
/** 回到这个页面时，超过这么久没刷新就自动刷新。 */
const STALE_MS = 60_000;

type Filter = 'ALL' | LedgerType;

Page({
  data: {
    filter: 'ALL' as Filter,
    filters: [
      { key: 'ALL', label: '全部' },
      { key: 'RECHARGE', label: '充值' },
      { key: 'CONSUME', label: '消费' },
    ],
    groups: [] as LedgerGroup[],
    loading: true,
    loadingMore: false,
    finished: false,
    error: '',
  },

  items: [] as LedgerItem[],
  page: 0,
  loadedAt: 0,
  /** 切换筛选时丢弃旧请求的结果。 */
  requestSeq: 0,

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    if (Date.now() - this.loadedAt > STALE_MS) {
      this.reload();
    }
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.loadingMore && !this.data.finished && !this.data.error) {
      this.loadMore();
    }
  },

  async reload() {
    this.items = [];
    this.page = 0;
    this.setData({ loading: this.data.groups.length === 0, finished: false, error: '' });
    await this.loadMore();
  },

  async loadMore() {
    const seq = ++this.requestSeq;
    const nextPage = this.page + 1;
    const filter = this.data.filter;
    if (nextPage > 1) {
      this.setData({ loadingMore: true });
    }
    try {
      const result = await fetchLedger({
        page: nextPage,
        pageSize: PAGE_SIZE,
        type: filter === 'ALL' ? undefined : filter,
      });
      if (seq !== this.requestSeq) {
        return;
      }
      this.items = nextPage === 1 ? result.items : this.items.concat(result.items);
      this.page = nextPage;
      this.loadedAt = Date.now();
      this.setData({
        groups: groupByDay(this.items),
        loading: false,
        loadingMore: false,
        finished: this.items.length >= result.total || result.items.length < PAGE_SIZE,
        error: '',
      });
    } catch (error) {
      if (seq !== this.requestSeq) {
        return;
      }
      if (nextPage === 1) {
        this.setData({ loading: false, loadingMore: false, groups: [], error: errorText(error) });
      } else {
        this.setData({ loadingMore: false });
        wx.showToast({ title: errorText(error), icon: 'none' });
      }
    }
  },

  switchFilter(event: WechatMiniprogram.TouchEvent) {
    const filter = String(event.currentTarget.dataset.key ?? 'ALL') as Filter;
    if (filter === this.data.filter) {
      return;
    }
    this.setData({ filter, groups: [] });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.reload();
  },

  retry() {
    this.reload();
  },

  openEntry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) {
      wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${encodeURIComponent(id)}` });
    }
  },
});
