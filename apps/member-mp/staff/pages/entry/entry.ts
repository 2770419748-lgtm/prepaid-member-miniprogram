import { fetchMember, recordMove } from '../../utils/api';
import { ApiError, messageOf } from '../../utils/errors';
import { LEDGER_TYPE_LABELS } from '../../utils/labels';
import { memberLabel } from '../../utils/ledger';
import { formatCent, formatChange, parseYuanToCent } from '../../utils/money';
import { needsRescan, untilText, validUntilText } from '../../utils/paycode';
import { maskPhone } from '../../utils/phone';
import { newRequestId } from '../../utils/request-id';
import { defaultOffsetCent, maxOffsetCent, offsetCapReason } from '../../utils/sale-order';
import { scanMemberCode, scanSaleOrder, useTypedOrder } from '../../utils/scan';
import { currentStore, rememberMember, requireSession } from '../../utils/session';
import { formatDateTime } from '../../utils/time';
import { goWorkbench } from '../../utils/nav';

type Kind = 'RECHARGE' | 'CONSUME';

/** 点了「确认」的这一笔。没拿到结果前一直沿用同一个请求号，重试不会重复记账。 */
interface Pending {
  requestId: string;
  amountCent: number;
  remark: string;
  /** 消费：抵的哪张单、商品金额多少。重试时原样带上。 */
  orderNo: string;
  orderNoTyped: boolean;
  productAmountCent: number;
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
  orderNo: string;
  product: string;
}

/** 消费：校验通过的商品金额和抵扣金额。 */
interface Valid {
  amountCent: number;
  productAmountCent: number;
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
    /** 消费：店员刚扫到的会员码。没有码不能扣款。 */
    payCode: '',
    codeText: '',
    needCode: false,
    /** 消费：九讯云订单号（A+数字）。没有订单不能扣款。 */
    orderNo: '',
    orderNoTyped: false,
    /** 条码扫不出来，正在手输单号。 */
    typingOrder: false,
    orderInput: '',
    orderError: '',
    /** 消费：商品应付金额（元，店员输入）。 */
    product: '',
    productError: '',
    /** 「最多可抵 239.90 元（商品金额的 10%）」。 */
    capText: '',
  },

  pending: null as Pending | null,
  /** 店员自己改过抵扣金额以后，改商品金额就不再自动填抵扣金额。 */
  amountTouched: false,

  onLoad(query: Record<string, string | undefined>) {
    const kind: Kind = query.kind === 'RECHARGE' ? 'RECHARGE' : 'CONSUME';
    const label = LEDGER_TYPE_LABELS[kind];
    wx.setNavigationBarTitle({ title: label });
    const payCode = kind === 'CONSUME' ? (query.payCode ?? '') : '';
    this.setData({
      memberId: query.memberId ?? '',
      kind,
      kindLabel: label,
      submitText: kind === 'CONSUME' ? '确认抵扣' : `确认${label}`,
      remarkPlaceholder: kind === 'RECHARGE' ? '如：现金、转账' : '如：消费项目',
      payCode,
      codeText: payCode ? untilText(query.until) : '',
      needCode: kind === 'CONSUME' && !payCode,
    });
    if (this.data.needCode) {
      return;
    }
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
    this.amountTouched = true;
    this.setData({ amount: event.detail.value });
    this.validate();
  },

  onRemarkInput(event: WechatMiniprogram.Input) {
    this.setData({ remark: event.detail.value });
  },

  /** 改商品金额：店员没自己改过抵扣金额时，自动填上能抵的最多金额（余额不够就填余额）。 */
  onProductInput(event: WechatMiniprogram.Input) {
    const product = event.detail.value;
    const parsed = parseYuanToCent(product);
    const update: Record<string, string> = { product };
    if (!this.amountTouched) {
      update.amount = parsed.ok ? formatCent(defaultOffsetCent(parsed.cent, this.data.balanceCent)).replace(/,/g, '') : '';
    }
    this.setData(update);
    this.validate();
  },

  /** 扫九讯云小票上的订单码。 */
  async onScanOrder() {
    const orderNo = await scanSaleOrder();
    if (orderNo) {
      this.setData({ orderNo, orderNoTyped: false, typingOrder: false, orderInput: '', orderError: '' });
      this.validate();
    }
  },

  onTypeOrder() {
    this.setData({ typingOrder: true, orderError: '' });
  },

  onCancelTypeOrder() {
    this.setData({ typingOrder: false, orderInput: '', orderError: '' });
  },

  onOrderInput(event: WechatMiniprogram.Input) {
    this.setData({ orderInput: event.detail.value, orderError: '' });
  },

  async onConfirmTypedOrder() {
    const result = await useTypedOrder(this.data.orderInput);
    if (!result) {
      return;
    }
    if ('reason' in result) {
      this.setData({ orderError: result.reason });
      return;
    }
    this.setData({ orderNo: result.orderNo, orderNoTyped: true, typingOrder: false, orderInput: '', orderError: '' });
    this.validate();
  },

  /** 换一张单：清掉单号，重新扫。 */
  onChangeOrder() {
    if (this.data.uncertain || this.data.submitting) {
      return;
    }
    this.setData({ orderNo: '', orderNoTyped: false });
    this.validate();
  },

  /** 校验并预览记账后余额。合法时返回金额，否则返回空。 */
  validate(): Valid | null {
    const { kind } = this.data;
    return kind === 'CONSUME' ? this.validateConsume() : this.validateRecharge();
  },

  validateRecharge(): Valid | null {
    const { amount, kindLabel, balanceCent } = this.data;
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
    this.setData({
      amountError: '',
      afterText: `记账后余额 ${formatCent(balanceCent + parsed.cent)} 元`,
      canSubmit: true,
      submitText: `确认${kindLabel} ${formatCent(parsed.cent)} 元`,
    });
    return { amountCent: parsed.cent, productAmountCent: 0 };
  },

  /** 消费：先有订单、商品金额，抵扣金额不超过商品金额的 10%、不超过余额。 */
  validateConsume(): Valid | null {
    const { amount, product, balanceCent, balance, orderNo } = this.data;
    const reset = {
      amountError: '',
      productError: '',
      afterText: '',
      capText: '',
      canSubmit: false,
      submitText: '确认抵扣',
    };
    if (!product.trim()) {
      this.setData(reset);
      return null;
    }
    const productParsed = parseYuanToCent(product);
    if (!productParsed.ok) {
      this.setData({ ...reset, productError: productParsed.reason });
      return null;
    }
    const cap = maxOffsetCent(productParsed.cent);
    const capText =
      cap > balanceCent
        ? `余额只有 ${balance} 元，最多抵 ${balance} 元`
        : `最多可抵 ${formatCent(cap)} 元（${offsetCapReason(productParsed.cent)}）`;
    if (!amount.trim()) {
      this.setData({ ...reset, capText });
      return null;
    }
    const parsed = parseYuanToCent(amount);
    if (!parsed.ok) {
      this.setData({ ...reset, capText, amountError: parsed.reason });
      return null;
    }
    if (parsed.cent > cap) {
      this.setData({
        ...reset,
        capText,
        amountError: `这单最多只能抵 ${formatCent(cap)} 元（${offsetCapReason(productParsed.cent)}）`,
      });
      return null;
    }
    if (parsed.cent > balanceCent) {
      this.setData({ ...reset, capText, amountError: `余额不足，当前余额 ${balance} 元` });
      return null;
    }
    this.setData({
      amountError: '',
      productError: '',
      capText,
      afterText: `抵扣后余额 ${formatCent(balanceCent - parsed.cent)} 元`,
      canSubmit: !!orderNo,
      submitText: orderNo ? `确认抵扣 ${formatCent(parsed.cent)} 元` : '先扫订单码',
    });
    return orderNo ? { amountCent: parsed.cent, productAmountCent: productParsed.cent } : null;
  },

  async onSubmit() {
    if (this.data.submitting || this.data.uncertain) {
      return;
    }
    const valid = this.validate();
    if (valid == null) {
      if (this.data.kind === 'CONSUME' && !this.data.orderNo) {
        this.setData({ orderError: '请先扫九讯云小票上的订单码' });
      } else if (this.data.kind === 'CONSUME' && !this.data.product.trim()) {
        this.setData({ productError: '请填商品应付金额' });
      } else if (!this.data.amount.trim()) {
        this.setData({ amountError: '请输入金额' });
      }
      return;
    }
    const { kind, kindLabel, balanceCent, orderNo } = this.data;
    const cent = valid.amountCent;
    const content =
      kind === 'CONSUME'
        ? `${this.data.memberLabel}\n订单 ${orderNo} · 商品 ${formatCent(valid.productAmountCent)} 元\n` +
          `抵扣 ${formatCent(cent)} 元，抵扣后余额 ${formatCent(balanceCent - cent)} 元`
        : `${this.data.memberLabel}\n${kindLabel} ${formatCent(cent)} 元\n记账后余额 ${formatCent(balanceCent + cent)} 元`;
    const { confirm } = await wx.showModal({
      title: kind === 'CONSUME' ? '确认抵扣' : `确认${kindLabel}`,
      content,
      confirmText: '确认',
      confirmColor: '#1677FF',
    });
    if (!confirm) {
      return;
    }
    this.pending = {
      requestId: newRequestId(),
      amountCent: cent,
      remark: this.data.remark.trim(),
      orderNo,
      orderNoTyped: this.data.orderNoTyped,
      productAmountCent: valid.productAmountCent,
    };
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
    const consume = this.data.kind === 'CONSUME';
    this.setData({ submitting: true });
    try {
      const result = await recordMove(this.data.memberId, this.data.kind, {
        storeId: this.data.storeId,
        amountCent: pending.amountCent,
        requestId: pending.requestId,
        ...(pending.remark ? { remark: pending.remark } : {}),
        ...(consume
          ? {
              payCode: this.data.payCode,
              orderNo: pending.orderNo,
              orderNoTyped: pending.orderNoTyped,
              productAmountCent: pending.productAmountCent,
            }
          : {}),
      });
      this.pending = null;
      const { entry } = result;
      this.setData({
        uncertain: false,
        done: {
          title: consume ? '抵扣成功' : `${this.data.kindLabel}成功`,
          change: formatChange(entry.changeCent),
          tone: entry.changeCent >= 0 ? 'plus' : 'minus',
          balance: formatCent(result.balanceCent),
          storeName: entry.storeName,
          time: formatDateTime(entry.createdAt),
          remark: entry.remark ?? '',
          replayed: result.replayed,
          orderNo: entry.orderNo ?? '',
          product: entry.productAmountCent != null ? formatCent(entry.productAmountCent) : '',
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        // 不知道服务端有没有记上：锁住金额和订单，只能用同一个请求号重试。
        this.setData({ uncertain: true });
        return;
      }
      // 明确没记上（例如别人刚扣过、余额不够了）：放弃这个请求号，刷新余额后可重新填写。
      this.pending = null;
      this.setData({ uncertain: false });
      if (needsRescan(error)) {
        // 会员码过期或用过了：请顾客刷新会员码再扫一次，金额不用重填。
        wx.showModal({
          title: '没有记上',
          content: messageOf(error),
          confirmText: '重新扫码',
          cancelText: '取消',
          confirmColor: '#1677FF',
          success: (res) => {
            if (res.confirm) {
              this.onRescan();
            }
          },
        });
        return;
      }
      if (consume && error instanceof ApiError && error.status === 409 && /这张单已经抵扣过/.test(error.message)) {
        // 这张单刚被别人抵了：清掉单号，换一张再扫。
        this.setData({ orderNo: '', orderNoTyped: false });
      }
      wx.showModal({ title: '没有记上', content: messageOf(error), showCancel: false, confirmText: '知道了' });
      this.load();
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 重新扫这位会员的会员码。扫到别人的码不换。 */
  async onRescan() {
    const session = requireSession();
    const store = session ? currentStore(session) : null;
    if (!store) {
      return;
    }
    const scanned = await scanMemberCode(store.id);
    if (!scanned) {
      return;
    }
    if (scanned.member.id !== this.data.memberId) {
      wx.showModal({
        title: '不是这位会员的会员码',
        content: `扫到的是 ${maskPhone(scanned.member.phone)} 的会员码。请让当前会员打开自己的会员码。`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    const first = this.data.needCode;
    this.setData({ payCode: scanned.code, codeText: validUntilText(scanned.expiresAt), needCode: false });
    if (first) {
      this.load();
    }
  },

  onBackToMember() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'staff/pages/member/member') {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: `/staff/pages/member/member?id=${this.data.memberId}` });
  },

  onNextMember() {
    goWorkbench();
  },
});
