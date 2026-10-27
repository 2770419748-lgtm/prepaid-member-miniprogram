import { fetchMember, recordMove } from '../../utils/api';
import { ApiError, messageOf } from '../../utils/errors';
import { LEDGER_TYPE_LABELS } from '../../utils/labels';
import { memberLabel } from '../../utils/ledger';
import { formatCent, formatChange, parseYuanToCent } from '../../utils/money';
import { newRequestId } from '../../utils/request-id';
import { currentStore, rememberMember, requireSession } from '../../utils/session';
import { formatDateTime } from '../../utils/time';

type Kind = 'RECHARGE' | 'CONSUME';

/** 点了「确认」的这一笔。没拿到结果前一直沿用同一个请求号，重试不会重复记账。 */
interface Pending {
  requestId: string;
  amountCent: number;
  remark: string;
}

interface Done {
  title: string;
  change: string;
  tone: 'plus' | 'minus';
  balance: string;
  storeName: string;
  time: string;
  remark: string;
  replayed: boolean;
}

Page({
  data: {
    memberId: '',
    kind: 'CONSUME' as Kind,
    kindLabel: '消费',
    ready: false,
    error: '',
    memberLabel: '',
    balanceCent: 0,
    balance: '0.00',
    storeId: '',
    storeName: '',
    amount: '',
    remark: '',
    remarkPlaceholder: '',
    amountError: '',
    afterText: '',
    canSubmit: false,
    submitText: '',
    submitting: false,
    uncertain: false,
    done: null as Done | null,
  },

  pending: null as Pending | null,

  onLoad(query: Record<string, string | undefined>) {
    const kind: Kind = query.kind === 'RECHARGE' ? 'RECHARGE' : 'CONSUME';
    const label = LEDGER_TYPE_LABELS[kind];
    wx.setNavigationBarTitle({ title: label });
    this.setData({
      memberId: query.memberId ?? '',
      kind,
      kindLabel: label,
      submitText: `确认${label}`,
      remarkPlaceholder: kind === 'RECHARGE' ? '如：现金、转账' : '如：消费项目',
    });
    this.load();
  },

  async load() {
    const session = requireSession();
    if (!session) {
      return;
    }
    const store = currentStore(session);
    if (!store) {
      this.setData({ error: '你所在的门店都已停用，暂时不能记账。' });
      return;
    }
    try {
      const member = await fetchMember(this.data.memberId);
      if (member.status === 'DISABLED') {
        this.setData({ error: '该会员已停用，不能记账。' });
        return;
      }
      if (!member.hasCard) {
        this.setData({ error: '该会员还没开卡，请先开卡。' });
        return;
      }
      rememberMember(member);
      const balanceCent = member.balanceCent ?? 0;
      this.setData({
        ready: true,
        error: '',
        memberLabel: memberLabel(member.phone, member.name),
        balanceCent,
        balance: formatCent(balanceCent),
        storeId: store.id,
        storeName: store.name,
      });
      this.validate();
    } catch (error) {
      this.setData({ error: messageOf(error) });
    }
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    this.setData({ amount: event.detail.value });
    this.validate();
  },

  onRemarkInput(event: WechatMiniprogram.Input) {
    this.setData({ remark: event.detail.value });
  },

  /** 校验金额并预览记账后余额。合法时返回分，否则返回空。 */
  validate(): number | null {
    const { amount, kind, kindLabel, balanceCent, balance } = this.data;
    const reset = { amountError: '', afterText: '', canSubmit: false, submitText: `确认${kindLabel}` };
    if (!amount.trim()) {
      this.setData(reset);
      return null;
    }
    const parsed = parseYuanToCent(amount);
    if (!parsed.ok) {
      this.setData({ ...reset, amountError: parsed.reason });
      return null;
    }
    const after = balanceCent + (kind === 'RECHARGE' ? parsed.cent : -parsed.cent);
    if (after < 0) {
      this.setData({ ...reset, amountError: `余额不足，当前余额 ${balance} 元` });
      return null;
    }
    this.setData({
      amountError: '',
      afterText: `记账后余额 ${formatCent(after)} 元`,
      canSubmit: true,
      submitText: `确认${kindLabel} ${formatCent(parsed.cent)} 元`,
    });
    return parsed.cent;
  },

  async onSubmit() {
    if (this.data.submitting || this.data.uncertain) {
      return;
    }
    const cent = this.validate();
    if (cent == null) {
      if (!this.data.amount.trim()) {
        this.setData({ amountError: '请输入金额' });
      }
      return;
    }
    const { kind, kindLabel, balanceCent } = this.data;
    const after = balanceCent + (kind === 'RECHARGE' ? cent : -cent);
    const { confirm } = await wx.showModal({
      title: `确认${kindLabel}`,
      content: `${this.data.memberLabel}\n${kindLabel} ${formatCent(cent)} 元\n记账后余额 ${formatCent(after)} 元`,
      confirmText: '确认',
      confirmColor: '#1677FF',
    });
    if (!confirm) {
      return;
    }
    this.pending = { requestId: newRequestId(), amountCent: cent, remark: this.data.remark.trim() };
    await this.submit();
  },

  async onRetry() {
    if (!this.data.submitting) {
      await this.submit();
    }
  },

  async submit() {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await recordMove(this.data.memberId, this.data.kind, {
        storeId: this.data.storeId,
        amountCent: pending.amountCent,
        requestId: pending.requestId,
        ...(pending.remark ? { remark: pending.remark } : {}),
      });
      this.pending = null;
      const { entry } = result;
      this.setData({
        uncertain: false,
        done: {
          title: `${this.data.kindLabel}成功`,
          change: formatChange(entry.changeCent),
          tone: entry.changeCent >= 0 ? 'plus' : 'minus',
          balance: formatCent(result.balanceCent),
          storeName: entry.storeName,
          time: formatDateTime(entry.createdAt),
          remark: entry.remark ?? '',
          replayed: result.replayed,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        // 不知道服务端有没有记上：锁住金额，只能用同一个请求号重试。
        this.setData({ uncertain: true });
        return;
      }
      // 明确没记上（例如别人刚扣过、余额不够了）：放弃这个请求号，刷新余额后可重新填写。
      this.pending = null;
      this.setData({ uncertain: false });
      wx.showModal({ title: '没有记上', content: messageOf(error), showCancel: false, confirmText: '知道了' });
      this.load();
    } finally {
      this.setData({ submitting: false });
    }
  },

  onBackToMember() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'pages/member/member') {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: `/pages/member/member?id=${this.data.memberId}` });
  },

  onNextMember() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
