import { fetchLedger, fetchMember } from '../../utils/api';
import { messageOf } from '../../utils/errors';
import { LedgerRow, toLedgerRow } from '../../utils/ledger';
import { formatCent } from '../../utils/money';
import { consumeEntryUrl } from '../../utils/paycode';
import { maskPhone } from '../../utils/phone';
import { scanMemberCode } from '../../utils/scan';
import { currentStore, rememberMember, requireSession } from '../../utils/session';
import { dayKey, dayLabel } from '../../utils/time';
import type { MemberCard } from '../../utils/types';

interface MemberHeader {
  phone: string;
  name: string | null;
  disabled: boolean;
  hasCard: boolean;
  openInfo: string;
  balance: string;
}

const HISTORY_SIZE = 10;

function header(member: MemberCard): MemberHeader {
  const openInfo = member.hasCard
    ? `${member.openStoreName ?? '门店'}开卡 · ${member.openedAt ? dayKey(member.openedAt) : ''}`
    : '还没开卡';
  return {
    phone: maskPhone(member.phone),
    name: member.name,
    disabled: member.status === 'DISABLED',
    hasCard: member.hasCard,
    openInfo,
    balance: formatCent(member.balanceCent ?? 0),
  };
}

Page({
  data: {
    id: '',
    phone: '',
    loading: true,
    error: '',
    noStore: false,
    member: null as MemberHeader | null,
    rows: [] as (LedgerRow & { date: string })[],
    historyTitle: '本店记录',
    historyNote: '',
    historyEmpty: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
  },

  onShow() {
    // 从记账页回来时余额已经变了，每次回到这页都重新取。
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    const session = requireSession();
    if (!session || !this.data.id) {
      return;
    }
    const unrestricted = session.access.unrestricted;
    this.setData({
      loading: true,
      noStore: !currentStore(session),
      historyTitle: unrestricted ? '最近记录' : '本店记录',
      historyNote: unrestricted ? '全部门店' : '只显示在你门店办理的',
    });
    try {
      const [member, ledger] = await Promise.all([
        fetchMember(this.data.id),
        fetchLedger({ memberId: this.data.id, pageSize: HISTORY_SIZE }),
      ]);
      rememberMember(member);
      this.setData({
        error: '',
        phone: member.phone,
        member: header(member),
        rows: ledger.items.map((entry) => ({
          ...toLedgerRow(entry, { showStore: unrestricted }),
          date: dayLabel(dayKey(entry.createdAt)),
        })),
        historyEmpty: unrestricted ? '还没有记录' : '在你的门店还没有记录',
      });
    } catch (error) {
      this.setData({ error: messageOf(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  onRecharge() {
    wx.navigateTo({ url: `/pages/entry/entry?memberId=${this.data.id}&kind=RECHARGE` });
  },

  /** 消费要先扫这位会员出示的会员码，扫到才能填金额。 */
  async onConsume() {
    const session = requireSession();
    const store = session ? currentStore(session) : null;
    if (!store) {
      return;
    }
    const scanned = await scanMemberCode(store.id);
    if (!scanned) {
      return;
    }
    if (scanned.member.id !== this.data.id) {
      wx.showModal({
        title: '不是这位会员的会员码',
        content: `扫到的是 ${maskPhone(scanned.member.phone)} 的会员码。请让当前会员打开自己的会员码。`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    wx.navigateTo({ url: consumeEntryUrl(scanned.member.id, scanned.code, scanned.expiresAt) });
  },

  onOpenCard() {
    wx.navigateTo({ url: `/pages/open/open?phone=${this.data.phone}` });
  },

  onEntry(event: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    wx.navigateTo({ url: `/pages/ledger-detail/ledger-detail?id=${event.currentTarget.dataset.id}` });
  },
});
