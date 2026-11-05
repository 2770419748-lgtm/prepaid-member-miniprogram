import { fetchLedgerEntry, LedgerItem } from '../../utils/api';
import { dateTime, formatChange, formatYuan } from '../../utils/format';
import { entryTitle } from '../../utils/ledger';
import { errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';

interface Detail {
  id: string;
  title: string;
  amountText: string;
  plus: boolean;
  storeName: string;
  timeText: string;
  balanceText: string;
  reversed: boolean;
  /** 撤销记录才有：被撤销的那一笔。 */
  reversalOfId: string;
  /** 白话说明这一笔对余额做了什么。 */
  note: string;
  /** 门店消费抵扣的订单号；没有为空。 */
  orderNo: string;
  /** 商品金额（元）；没有为空。 */
  productText: string;
}

function toDetail(entry: LedgerItem): Detail {
  const title = entryTitle(entry);
  let note = '';
  if (entry.type === 'REVERSAL') {
    if (entry.reversalOfType === 'REFUND') {
      note = '门店撤销了一笔记错的退款，这笔钱已回到您的余额。';
    } else {
      note = entry.changeCent > 0 ? '门店撤销了一笔记错的消费，这笔钱已退回您的余额。' : '门店撤销了一笔记错的充值，这笔钱已从余额扣回。';
    }
  } else if (entry.type === 'REFUND' && !entry.reversed) {
    note = '门店已把这笔储值退给您，余额相应减少。';
  } else if (entry.reversed) {
    note = '这笔记录有误，门店已撤销，对余额的影响已经抵消。';
  }
  return {
    id: entry.id,
    title,
    amountText: formatChange(entry.changeCent),
    plus: entry.changeCent > 0,
    storeName: entry.storeName,
    timeText: dateTime(entry.createdAt),
    balanceText: formatYuan(entry.balanceAfter),
    reversed: entry.reversed,
    reversalOfId: entry.reversalOfId ?? '',
    note,
    orderNo: entry.orderNo ?? '',
    productText: entry.productAmountCent != null ? formatYuan(entry.productAmountCent) : '',
  };
}

Page({
  data: {
    loading: true,
    error: '',
    detail: null as Detail | null,
  },

  entryId: '',

  onLoad(options: Record<string, string | undefined>) {
    this.entryId = decodeURIComponent(options.id ?? '');
    if (!ensureLogin()) {
      return;
    }
    this.load();
  },

  async load() {
    if (!this.entryId) {
      this.setData({ loading: false, error: '没有找到这条明细' });
      return;
    }
    try {
      const entry = await fetchLedgerEntry(this.entryId);
      this.setData({ loading: false, error: '', detail: toDetail(entry) });
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  openOriginal() {
    const id = this.data.detail?.reversalOfId;
    if (id) {
      wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${encodeURIComponent(id)}` });
    }
  },

  copyId() {
    const id = this.data.detail?.id;
    if (id) {
      wx.setClipboardData({ data: id });
    }
  },
});
