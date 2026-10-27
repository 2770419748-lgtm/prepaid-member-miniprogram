import { fetchLedger } from '../../utils/api';
import { messageOf } from '../../utils/errors';
import { groupByDay, LedgerDay } from '../../utils/ledger';
import { currentStore, requireSession } from '../../utils/session';
import { startOfDaysAgo } from '../../utils/time';
import type { LedgerEntry, LedgerType } from '../../utils/types';

const PAGE_SIZE = 20;

const RANGES = [
  { value: 1, label: '今天' },
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
];

const TYPES: { value: LedgerType | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'RECHARGE', label: '充值' },
  { value: 'CONSUME', label: '消费' },
  { value: 'REVERSAL', label: '冲正' },
];

Page({
  data: {
    storeId: '',
    storeName: '',
    ranges: RANGES,
    types: TYPES,
    range: 1,
    type: '' as LedgerType | '',
    days: [] as LedgerDay[],
    summary: '',
    emptyText: '',
    page: 0,
    hasMore: false,
    loading: false,
    error: '',
  },

  entries: [] as LedgerEntry[],
  /** 每次重新查询加一，丢弃过期请求的结果（切换筛选时旧请求晚到）。 */
  generation: 0,

  onShow() {
    const session = requireSession();
    if (!session) {
      return;
    }
    const store = currentStore(session);
    this.setData({
      storeId: store ? store.id : '',
      storeName: store ? store.name : '没有可用门店',
    });
    // 每次回到这页都从第一页刷新：可能刚记完账或刚冲正。
    this.reload();
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.fetchPage(this.data.page + 1, this.generation);
    }
  },

  onRange(event: WechatMiniprogram.BaseEvent<Record<string, never>, { value: number }>) {
    this.setData({ range: Number(event.currentTarget.dataset.value) });
    this.reload();
  },

  onType(event: WechatMiniprogram.BaseEvent<Record<string, never>, { value: LedgerType | '' }>) {
    this.setData({ type: event.currentTarget.dataset.value });
    this.reload();
  },

  reload() {
    this.generation += 1;
    this.entries = [];
    this.setData({ days: [], page: 0, hasMore: false, summary: '', error: '' });
    if (!this.data.storeId) {
      this.setData({ emptyText: '没有可用门店' });
      return Promise.resolve();
    }
    return this.fetchPage(1, this.generation);
  },

  async fetchPage(page: number, generation: number) {
    this.setData({ loading: true });
    try {
      const result = await fetchLedger({
        storeId: this.data.storeId,
        type: this.data.type || undefined,
        from: startOfDaysAgo(this.data.range),
        page,
        pageSize: PAGE_SIZE,
      });
      if (generation !== this.generation) {
        return;
      }
      this.entries = this.entries.concat(result.items);
      const rangeLabel = RANGES.find((item) => item.value === this.data.range)?.label ?? '';
      this.setData({
        days: groupByDay(this.entries),
        page,
        hasMore: page * PAGE_SIZE < result.total,
        summary: `${rangeLabel}共 ${result.total} 笔`,
        emptyText: this.data.type ? '没有符合条件的记录' : `${rangeLabel}还没有记账`,
      });
    } catch (error) {
      if (generation === this.generation) {
        this.setData({ error: messageOf(error) });
      }
    } finally {
      if (generation === this.generation) {
        this.setData({ loading: false });
      }
    }
  },

  onEntry(event: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${event.currentTarget.dataset.id}` });
  },
});
