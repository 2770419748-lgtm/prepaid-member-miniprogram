import {
  cancelSignFlow,
  createSignFlow,
  fetchActiveTemplates,
  fetchBenefitPlan,
  fetchMember,
  fetchMemberAppCode,
  fetchSignFlows,
  findMemberByPhone,
  openCard,
  refreshSignFlow,
  renewSignUrl,
} from '../../utils/api';
import { ApiError, messageOf } from '../../utils/errors';
import { memberLabel } from '../../utils/ledger';
import { formatCent, parseYuanToCent } from '../../utils/money';
import {
  canCancelFlow,
  DEMO_APP_CODE_TEXT,
  OrderStep,
  POLL_LIMIT_MS,
  POLL_MS,
  signProgress,
  stepDots,
} from '../../utils/order';
import { isMainlandMobile, maskPhone, normalizePhone } from '../../utils/phone';
import { drawQr, encodeText, QrContext } from '../../utils/qrcode';
import { newRequestId } from '../../utils/request-id';
import { currentStore, rememberMember, requireSession } from '../../utils/session';
import type { BenefitItem, MemberCard, SignFlow } from '../../utils/types';

/** 这一单的顾客。还没开卡的在生成合同时才开，免得填到一半走了留下空卡。 */
interface OrderMember {
  id: string | null;
  phone: string;
  name: string | null;
  label: string;
  hasCard: boolean;
  balance: string;
}

interface TemplateOption {
  id: string;
  name: string;
  planId: string | null;
}

interface BenefitPreview {
  title: string;
  items: BenefitItem[];
  rules: string | null;
}

/** 点了「生成合同」的这一次。没拿到结果前沿用同一个请求号，重试不会发出两份合同。 */
interface Pending {
  requestId: string;
  amountCent: number;
  templateId: string;
}

interface CanvasHit {
  node?: { width: number; height: number; getContext(type: '2d'): QrContext };
  width: number;
}

function toOrderMember(card: MemberCard | null, phone: string, name: string | null): OrderMember {
  const shownName = card?.name ?? name;
  return {
    id: card ? card.id : null,
    phone,
    name: shownName,
    label: memberLabel(phone, shownName),
    hasCard: card ? card.hasCard : false,
    balance: formatCent(card?.balanceCent ?? 0),
  };
}

Page({
  data: {
    step: 'phone' as OrderStep,
    steps: stepDots('phone'),
    storeId: '',
    storeName: '',
    noStore: false,

    phone: '',
    name: '',
    phoneError: '',
    checking: false,

    member: null as OrderMember | null,
    templates: [] as TemplateOption[],
    templateIndex: 0,
    benefit: null as BenefitPreview | null,
    loadingTemplates: false,
    amount: '',
    amountError: '',
    amountHint: '',
    canCreate: false,
    submitting: false,
    uncertain: false,

    flowId: '',
    flowTitle: '',
    flowAmount: '',
    sandbox: false,
    signUrl: '',
    progress: 'waiting' as 'waiting' | 'recharging' | 'done' | 'ended',
    endedTitle: '',
    endedText: '',
    pollStopped: false,
    refreshing: false,
    canCancel: false,

    balance: '',
    showCode: false,
    codeImage: '',
    codeDemo: false,
    codeMessage: '',
    codeLoading: false,
    codePhone: '',
  },

  pending: null as Pending | null,
  plans: {} as Record<string, BenefitPreview>,
  pollTimer: 0 as number,
  pollSince: 0,
  drawnUrl: '',
  closed: false,

  onLoad(query: Record<string, string | undefined>) {
    this.plans = {};
    this.setData({ phone: query.phone ?? '' });
    const session = requireSession();
    if (!session) {
      return;
    }
    this.useStore();
    if (query.flowId) {
      this.resume(query.flowId);
    } else if (query.memberId) {
      this.startFor(query.memberId);
    }
  },

  onShow() {
    this.closed = false;
    if (this.data.step === 'sign' && this.data.flowId && !this.data.pollStopped) {
      this.schedulePoll(true);
    }
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.closed = true;
    this.stopPoll();
  },

  useStore() {
    const session = requireSession();
    const store = session ? currentStore(session) : null;
    this.setData({
      storeId: store ? store.id : '',
      storeName: store ? store.name : '没有可用门店',
      noStore: !store,
    });
  },

  goStep(step: OrderStep) {
    this.setData({ step, steps: stepDots(step) });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  // ---- 第一步：手机号 ----

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ phone: event.detail.value, phoneError: '' });
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },

  async onNext() {
    if (this.data.checking || this.data.noStore) {
      return;
    }
    const phone = normalizePhone(this.data.phone);
    if (!isMainlandMobile(phone)) {
      this.setData({ phoneError: '请输入 11 位手机号' });
      return;
    }
    this.setData({ checking: true, phoneError: '' });
    try {
      const card = await findMemberByPhone(phone);
      if (card && card.status === 'DISABLED') {
        this.setData({ phoneError: '该会员已停用，不能开单。需要恢复请联系管理员。' });
        return;
      }
      this.setData({ member: toOrderMember(card, phone, this.data.name.trim() || null) });
      await this.enterBenefit();
    } catch (error) {
      this.setData({ phoneError: messageOf(error) });
    } finally {
      this.setData({ checking: false });
    }
  },

  /** 从会员页「办理权益单」进来：已经知道是谁，直接填权益。 */
  async startFor(memberId: string) {
    try {
      const card = await fetchMember(memberId);
      if (card.status === 'DISABLED') {
        this.setData({ phone: card.phone, phoneError: '该会员已停用，不能开单。需要恢复请联系管理员。' });
        return;
      }
      this.setData({ phone: card.phone, member: toOrderMember(card, card.phone, null) });
      await this.enterBenefit();
    } catch (error) {
      wx.showModal({ title: '打不开这位会员', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    }
  },

  // ---- 第二步：填权益 ----

  async enterBenefit() {
    this.pending = null;
    this.setData({ uncertain: false, amountError: '' });
    this.goStep('benefit');
    if (this.data.templates.length) {
      return;
    }
    this.setData({ loadingTemplates: true });
    try {
      const templates = await fetchActiveTemplates();
      this.setData({
        templates: templates.map((item) => ({
          id: item.id,
          name: item.name,
          planId: item.benefitPlan ? item.benefitPlan.id : null,
        })),
        templateIndex: 0,
      });
      await this.showPlan();
    } catch (error) {
      wx.showModal({ title: '没有取到权益单', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    } finally {
      this.setData({ loadingTemplates: false });
      this.validate();
    }
  },

  async showPlan() {
    const template = this.data.templates[this.data.templateIndex];
    if (!template || !template.planId) {
      this.setData({ benefit: null });
      return;
    }
    const cached = this.plans[template.planId];
    if (cached) {
      this.setData({ benefit: cached });
      return;
    }
    try {
      const plan = await fetchBenefitPlan(template.planId);
      const preview = { title: plan.title, items: plan.items, rules: plan.rules };
      this.plans[template.planId] = preview;
      if (this.data.templates[this.data.templateIndex]?.planId === template.planId) {
        this.setData({ benefit: preview });
      }
    } catch {
      this.setData({ benefit: null });
    }
  },

  onPickTemplate(event: WechatMiniprogram.BaseEvent<Record<string, never>, { index: number }>) {
    if (this.data.uncertain) {
      return;
    }
    this.setData({ templateIndex: Number(event.currentTarget.dataset.index) });
    this.showPlan();
    this.validate();
  },

  /** 还没生成合同时可以换一位顾客。 */
  onChangeMember() {
    if (this.data.submitting || this.data.uncertain) {
      return;
    }
    this.pending = null;
    this.setData({ member: null });
    this.goStep('phone');
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    this.setData({ amount: event.detail.value });
    this.validate();
  },

  /** 校验会员权益金额。合法时返回分。 */
  validate(): number | null {
    const hasTemplate = this.data.templates.length > 0;
    if (!this.data.amount.trim()) {
      this.setData({ amountError: '', amountHint: '', canCreate: false });
      return null;
    }
    const parsed = parseYuanToCent(this.data.amount);
    if (!parsed.ok) {
      this.setData({ amountError: parsed.reason, amountHint: '', canCreate: false });
      return null;
    }
    this.setData({
      amountError: '',
      amountHint: `顾客签完合同后，${formatCent(parsed.cent)} 元自动充值到会员余额`,
      canCreate: hasTemplate,
    });
    return parsed.cent;
  },

  async onCreate() {
    if (this.data.submitting || this.data.uncertain || !this.data.member) {
      return;
    }
    const cent = this.validate();
    if (cent == null) {
      if (!this.data.amount.trim()) {
        this.setData({ amountError: '请填写会员权益金额' });
      }
      return;
    }
    const template = this.data.templates[this.data.templateIndex];
    if (!template) {
      return;
    }
    const { confirm } = await wx.showModal({
      title: '生成合同',
      content: `${this.data.member.label}\n${template.name}\n会员权益金额 ${formatCent(cent)} 元\n顾客签完合同后才充值到账`,
      confirmText: '生成合同',
      confirmColor: '#1677FF',
    });
    if (!confirm) {
      return;
    }
    this.pending = { requestId: newRequestId(), amountCent: cent, templateId: template.id };
    await this.create();
  },

  async onRetry() {
    if (!this.data.submitting) {
      await this.create();
    }
  },

  async create() {
    const pending = this.pending;
    const member = this.data.member;
    if (!pending || !member) {
      return;
    }
    this.setData({ submitting: true });
    try {
      const memberId = await this.ensureCard(member);
      const flow = await createSignFlow({
        memberId,
        templateId: pending.templateId,
        storeId: this.data.storeId,
        rechargeAmountCent: pending.amountCent,
        requestId: pending.requestId,
      });
      this.pending = null;
      this.setData({ uncertain: false });
      this.showFlow(flow);
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        // 不知道合同发出去没有：锁住金额，只能用同一个请求号重试，不会发出两份。
        this.setData({ uncertain: true });
        return;
      }
      this.pending = null;
      this.setData({ uncertain: false });
      if (error instanceof ApiError && error.status === 409 && this.data.member?.id) {
        const open = await fetchSignFlows({
          memberId: this.data.member.id,
          templateId: pending.templateId,
          status: 'PENDING',
          pageSize: 1,
        }).catch(() => []);
        if (open[0]) {
          this.offerResume(open[0]);
          return;
        }
      }
      wx.showModal({ title: '没有生成合同', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 新顾客到这一步才开卡（余额 0）。别人刚好开过了就直接用那张卡。 */
  async ensureCard(member: OrderMember): Promise<string> {
    if (member.id && member.hasCard) {
      return member.id;
    }
    let card: MemberCard;
    try {
      card = await openCard({
        phone: member.phone,
        storeId: this.data.storeId,
        ...(member.name ? { name: member.name } : {}),
      });
    } catch (error) {
      const existing = error instanceof ApiError && error.status === 409 ? await findMemberByPhone(member.phone) : null;
      if (!existing || !existing.hasCard) {
        throw error;
      }
      card = existing;
    }
    rememberMember(card);
    this.setData({ member: toOrderMember(card, member.phone, member.name) });
    return card.id;
  },

  offerResume(flow: SignFlow) {
    const amount = flow.rechargeAmountCent != null ? `，会员权益金额 ${formatCent(flow.rechargeAmountCent)} 元` : '';
    wx.showModal({
      title: '还有一份没签完',
      content: `这位顾客还有一份「${flow.title}」没签${amount}。先让顾客签完这份，或请店长撤销后重新开单。`,
      confirmText: '继续签这份',
      cancelText: '取消',
      confirmColor: '#1677FF',
      success: (res) => {
        if (res.confirm) {
          this.showFlow(flow);
        }
      },
    });
  },

  // ---- 第三步：签合同 ----

  async resume(flowId: string) {
    try {
      this.showFlow(await refreshSignFlow(flowId));
    } catch (error) {
      wx.showModal({ title: '打不开这份合同', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    }
  },

  showFlow(flow: SignFlow) {
    const session = requireSession();
    if (!session) {
      return;
    }
    const progress = signProgress(flow);
    const label = memberLabel(flow.member.phone, flow.member.name);
    this.setData({
      flowId: flow.id,
      flowTitle: flow.title,
      flowAmount: flow.rechargeAmountCent != null ? formatCent(flow.rechargeAmountCent) : '',
      sandbox: flow.env === 'SANDBOX',
      signUrl: flow.signUrl ?? '',
      progress: progress.kind,
      endedTitle: progress.kind === 'ended' ? progress.title : '',
      endedText: progress.kind === 'ended' ? progress.text : '',
      canCancel: canCancelFlow(flow, session.access),
      member: this.data.member ?? {
        id: flow.member.id,
        phone: flow.member.phone,
        name: flow.member.name,
        label,
        hasCard: true,
        balance: '',
      },
    });
    if (progress.kind === 'done') {
      this.stopPoll();
      this.finish();
      return;
    }
    if (this.data.step !== 'sign') {
      this.goStep('sign');
      this.pollSince = Date.now();
      this.setData({ pollStopped: false });
    }
    if (progress.kind === 'ended') {
      this.stopPoll();
      return;
    }
    if (progress.kind === 'waiting') {
      if (flow.signUrl) {
        this.drawSignCode(flow.signUrl);
      } else {
        this.fetchSignUrl();
      }
    }
    this.schedulePoll(false);
  },

  /** 链接没取到（电子签平台慢了一下）时再要一次。 */
  async fetchSignUrl() {
    try {
      const flow = await renewSignUrl(this.data.flowId);
      if (flow.signUrl) {
        this.setData({ signUrl: flow.signUrl });
        this.drawSignCode(flow.signUrl);
      }
    } catch {
      // 下次刷新再取。
    }
  },

  drawSignCode(url: string) {
    if (url === this.drawnUrl) {
      return;
    }
    wx.nextTick(() => {
      this.drawCode('#sign-qr', url, () => {
        this.drawnUrl = url;
      });
    });
  },

  drawCode(selector: string, text: string, done?: () => void) {
    wx.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res: (CanvasHit | null)[]) => {
        const hit = res[0];
        if (!hit || !hit.node) {
          return;
        }
        // 按真实像素画，格子边缘才清楚。
        const side = Math.round(hit.width * wx.getWindowInfo().pixelRatio);
        hit.node.width = side;
        hit.node.height = side;
        drawQr(hit.node.getContext('2d'), encodeText(text), side);
        if (done) {
          done();
        }
      });
  },

  schedulePoll(immediate: boolean) {
    this.stopPoll();
    if (this.closed) {
      return;
    }
    if (Date.now() - this.pollSince > POLL_LIMIT_MS) {
      this.setData({ pollStopped: true });
      return;
    }
    this.pollTimer = setTimeout(() => this.poll(), immediate ? 0 : POLL_MS) as unknown as number;
  },

  stopPoll() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }
  },

  async poll() {
    this.pollTimer = 0;
    if (this.closed || this.data.step !== 'sign') {
      return;
    }
    try {
      this.showFlow(await refreshSignFlow(this.data.flowId));
    } catch {
      // 网络抖一下不打扰店员，下一轮再问。
      this.schedulePoll(false);
    }
  },

  async onRefresh() {
    if (this.data.refreshing) {
      return;
    }
    this.setData({ refreshing: true, pollStopped: false });
    this.pollSince = Date.now();
    try {
      this.showFlow(await refreshSignFlow(this.data.flowId));
    } catch (error) {
      wx.showToast({ title: messageOf(error), icon: 'none' });
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onCopyLink() {
    if (this.data.signUrl) {
      wx.setClipboardData({ data: this.data.signUrl });
    }
  },

  /** 店长撤销这份合同（例如金额填错），撤完回到填权益重新开。 */
  onCancelFlow() {
    wx.showModal({
      title: '撤销这份合同',
      editable: true,
      placeholderText: '撤销原因，如：金额填错',
      confirmText: '撤销',
      confirmColor: '#DC2626',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        const reason = (res.content ?? '').trim();
        if (!reason) {
          wx.showToast({ title: '请填写撤销原因', icon: 'none' });
          return;
        }
        try {
          this.showFlow(await cancelSignFlow(this.data.flowId, reason));
        } catch (error) {
          wx.showModal({ title: '没有撤销', content: messageOf(error), showCancel: false, confirmText: '知道了' });
        }
      },
    });
  },

  /** 合同没签成（拒签、过期、撤销）：同一位顾客重新填权益。 */
  onReorder() {
    this.stopPoll();
    this.drawnUrl = '';
    this.setData({ flowId: '', signUrl: '' });
    this.enterBenefit();
  },

  onLater() {
    this.stopPoll();
    wx.switchTab({ url: '/pages/index/index' });
  },

  // ---- 第四步：到账，弹会员小程序码 ----

  async finish() {
    if (this.data.step === 'done') {
      return;
    }
    this.goStep('done');
    const memberId = this.data.member?.id;
    if (memberId) {
      fetchMember(memberId)
        .then((card) => {
          rememberMember(card);
          this.setData({ balance: formatCent(card.balanceCent ?? 0) });
        })
        .catch(() => undefined);
    }
    this.onShowCode();
  },

  async onShowCode() {
    this.setData({ showCode: true, codePhone: this.data.member ? maskPhone(this.data.member.phone) : '' });
    if (this.data.codeImage || this.data.codeDemo || this.data.codeLoading) {
      this.drawDemoCode();
      return;
    }
    this.setData({ codeLoading: true });
    try {
      const code = await fetchMemberAppCode();
      this.setData({ codeImage: code.image ?? '', codeDemo: code.demo, codeMessage: code.message ?? '' });
    } catch (error) {
      this.setData({ codeMessage: messageOf(error) });
    } finally {
      this.setData({ codeLoading: false });
      this.drawDemoCode();
    }
  },

  drawDemoCode() {
    if (this.data.codeDemo && !this.data.codeImage) {
      wx.nextTick(() => this.drawCode('#app-qr', DEMO_APP_CODE_TEXT));
    }
  },

  onCloseCode() {
    this.setData({ showCode: false });
  },

  /** 点码的白卡片不关弹层。 */
  noop() {},

  onViewMember() {
    const memberId = this.data.member?.id;
    if (memberId) {
      wx.redirectTo({ url: `/pages/member/member?id=${memberId}` });
    }
  },

  onHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
