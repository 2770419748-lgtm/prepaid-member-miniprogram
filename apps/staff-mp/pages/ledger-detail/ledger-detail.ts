import { fetchLedgerEntry, reverseEntry } from '../../utils/api';
import { ApiError, messageOf } from '../../utils/errors';
import { ledgerTitle } from '../../utils/labels';
import { canReverse, memberLabel } from '../../utils/ledger';
import { formatCent, formatChange } from '../../utils/money';
import { newRequestId } from '../../utils/request-id';
import { requireSession } from '../../utils/session';
import { formatDateTime } from '../../utils/time';
import type { LedgerEntry } from '../../utils/types';

interface DetailView {
  title: string;
  change: string;
  tone: 'plus' | 'minus';
  reversed: boolean;
  isReversal: boolean;
  member: string;
  storeName: string;
  operator: string;
  time: string;
  before: string;
  after: string;
  remark: string;
  reversedById: string;
  reversalOfId: string;
}

function toView(entry: LedgerEntry): DetailView {
  return {
    title: ledgerTitle(entry.type, entry.changeCent),
    change: formatChange(entry.changeCent),
    tone: entry.changeCent >= 0 ? 'plus' : 'minus',
    reversed: entry.reversedById != null,
    isReversal: entry.type === 'REVERSAL',
    member: memberLabel(entry.memberPhone, entry.memberName),
    storeName: entry.storeName,
    operator: entry.operatorName ?? '—',
    time: formatDateTime(entry.createdAt),
    before: formatCent(entry.balanceBefore),
    after: formatCent(entry.balanceAfter),
    remark: entry.remark || '无',
    reversedById: entry.reversedById ?? '',
    reversalOfId: entry.reversalOfId ?? '',
  };
}

Page({
  data: {
    id: '',
    error: '',
    view: null as DetailView | null,
    canReverse: false,
    askManager: false,
    submitting: false,
  },

  /** 冲正的请求号与原因。没收到结果时用同一个号重试。 */
  pending: null as { requestId: string; remark: string } | null,

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
  },

  onShow() {
    this.load();
  },

  async load() {
    const session = requireSession();
    if (!session || !this.data.id) {
      return;
    }
    try {
      const entry = await fetchLedgerEntry(this.data.id);
      const allowed = canReverse(entry, session.access);
      const reversible = entry.type !== 'REVERSAL' && !entry.reversedById;
      this.setData({
        error: '',
        view: toView(entry),
        canReverse: allowed,
        askManager: reversible && !allowed,
      });
    } catch (error) {
      this.setData({ error: messageOf(error) });
    }
  },

  async onReverse() {
    if (this.data.submitting) {
      return;
    }
    const answer = await wx.showModal({
      title: '冲正这笔',
      editable: true,
      placeholderText: '请填写原因，如：金额录错',
      confirmText: '确认冲正',
      confirmColor: '#DC2626',
    });
    if (!answer.confirm) {
      return;
    }
    const remark = (answer.content || '').trim();
    if (!remark) {
      wx.showToast({ title: '请填写冲正原因', icon: 'none' });
      return;
    }
    this.pending = { requestId: newRequestId(), remark };
    await this.submit();
  },

  async submit() {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.setData({ submitting: true });
    try {
      await reverseEntry(this.data.id, pending);
      this.pending = null;
      wx.showToast({ title: '已冲正', icon: 'success' });
      await this.load();
    } catch (error) {
      this.setData({ submitting: false });
      if (error instanceof ApiError && error.uncertain) {
        const answer = await wx.showModal({
          title: '没有收到结果',
          content: '可能已经冲正了。点「重试」不会重复冲正。',
          confirmText: '重试',
        });
        if (answer.confirm) {
          await this.submit();
          return;
        }
      } else {
        wx.showModal({ title: '没有冲正', content: messageOf(error), showCancel: false, confirmText: '知道了' });
      }
      this.pending = null;
      await this.load();
    } finally {
      this.setData({ submitting: false });
    }
  },

  onOpen(event: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${event.currentTarget.dataset.id}` });
  },
});
