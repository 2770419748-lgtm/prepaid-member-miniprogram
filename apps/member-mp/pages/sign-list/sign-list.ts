import { fetchSignFlows, SignFlowView } from '../../utils/api';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';
import { SignRow, toSignRow } from '../../utils/sign';

const PAGE_SIZE = 20;

Page({
  data: {
    rows: [] as SignRow[],
    loading: true,
    loadingMore: false,
    finished: false,
    error: '',
  },

  items: [] as SignFlowView[],
  page: 0,
  requestSeq: 0,

  // 从签署页回来时状态可能变了，每次显示都从第一页重新取（权益单很少，不费流量）。
  onShow() {
    if (!ensureLogin()) {
      return;
    }
    this.reload();
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
    this.setData({ loading: this.data.rows.length === 0, finished: false, error: '' });
    await this.loadMore();
  },

  async loadMore() {
    const seq = ++this.requestSeq;
    const nextPage = this.page + 1;
    if (nextPage > 1) {
      this.setData({ loadingMore: true });
    }
    try {
      const result = await fetchSignFlows({ page: nextPage, pageSize: PAGE_SIZE });
      if (seq !== this.requestSeq) {
        return;
      }
      this.items = nextPage === 1 ? result.items : this.items.concat(result.items);
      this.page = nextPage;
      this.setData({
        rows: this.items.map(toSignRow),
        loading: false,
        loadingMore: false,
        finished: this.items.length >= result.total || result.items.length < PAGE_SIZE,
        error: '',
      });
    } catch (error) {
      if (seq !== this.requestSeq) {
        return;
      }
      if (this.data.rows.length === 0) {
        this.setData({ loading: false, loadingMore: false, error: errorText(error) });
      } else {
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: errorText(error), icon: 'none' });
      }
    }
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.reload();
  },

  openFlow(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (id) {
      wx.navigateTo({ url: `/pages/sign/sign?id=${encodeURIComponent(id)}` });
    }
  },
});
