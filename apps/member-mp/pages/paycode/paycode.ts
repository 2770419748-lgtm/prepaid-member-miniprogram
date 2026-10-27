import { fetchPayCodeState, fetchWallet, issuePayCode, PayCodeState } from '../../utils/api';
import { formatYuan } from '../../utils/format';
import { CodeView, nextStep, POLL_MS, UsedView } from '../../utils/paycode';
import { drawQr, encodeDigits, QrContext } from '../../utils/qrcode';
import { ApiError, errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';

interface CanvasHit {
  node?: { width: number; height: number; getContext(type: '2d'): QrContext };
  width: number;
}

function noop(): void {
  // 屏幕亮度、常亮、防截屏在部分机型上不可用，失败了也不影响出示会员码。
}

/**
 * 会员码：到店消费时出示，门店扫码后才能扣款。
 * 码每 30 秒换一次、只能用一次；被扫以后不再换码，等门店扣完款在这里显示结果。
 */
Page({
  data: {
    view: 'loading' as CodeView,
    message: '',
    balanceText: '',
    refreshSeconds: 30,
    storeName: '',
    used: null as UsedView | null,
  },

  codeId: '',
  code: '',
  visible: false,
  /** 每换一次码加一。慢回来的旧请求看到代数变了就不再动页面。 */
  generation: 0,
  renewing: false,
  refreshTimer: 0,
  pollTimer: 0,
  brightness: -1,

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    this.visible = true;
    this.guardScreen(true);
    if (this.data.view !== 'used') {
      this.renew();
    }
  },

  onHide() {
    this.leave();
  },

  onUnload() {
    this.leave();
  },

  leave() {
    this.visible = false;
    this.stopTimers();
    this.guardScreen(false);
  },

  stopTimers() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.pollTimer);
    this.refreshTimer = 0;
    this.pollTimer = 0;
  },

  /** 出示时屏幕常亮、调到最亮、截屏录屏时隐藏画面；有人截屏就马上换码。离开页面全部还原。 */
  guardScreen(on: boolean) {
    wx.setKeepScreenOn({ keepScreenOn: on, fail: noop });
    if (on) {
      wx.getScreenBrightness({
        success: (res) => {
          this.brightness = res.value;
          wx.setScreenBrightness({ value: 1, fail: noop });
        },
        fail: noop,
      });
      wx.setVisualEffectOnCapture({ visualEffect: 'hidden', fail: noop });
      wx.onUserCaptureScreen(() => this.onCapture());
      return;
    }
    if (this.brightness >= 0) {
      wx.setScreenBrightness({ value: this.brightness, fail: noop });
      this.brightness = -1;
    }
    wx.setVisualEffectOnCapture({ visualEffect: 'none', fail: noop });
    wx.offUserCaptureScreen();
  },

  onCapture() {
    if (this.visible && this.data.view === 'code') {
      wx.showToast({ title: '截图不能用来消费，已换新码', icon: 'none' });
      this.renew();
    }
  },

  /** 取一张新码。旧的没被扫的码同时作废。 */
  async renew() {
    if (this.renewing) {
      return;
    }
    this.renewing = true;
    this.generation += 1;
    this.stopTimers();
    try {
      const [issued, wallet] = await Promise.all([issuePayCode(), fetchWallet()]);
      if (!this.visible) {
        return;
      }
      this.codeId = issued.id;
      this.code = issued.code;
      this.setData(
        {
          view: 'code',
          message: '',
          storeName: '',
          balanceText: formatYuan(wallet.balanceCent),
          refreshSeconds: issued.refreshAfterSeconds,
        },
        () => this.draw(issued.code),
      );
      const generation = this.generation;
      this.refreshTimer = setTimeout(() => this.check(generation, true), issued.refreshAfterSeconds * 1000);
      this.schedulePoll();
    } catch (error) {
      // 400 是没开卡或卡已停用，换码也没用；其他（网络）可以重试。
      const blocked = error instanceof ApiError && error.status === 400;
      this.setData({ view: blocked ? 'blocked' : 'error', message: errorText(error) });
    } finally {
      this.renewing = false;
    }
  },

  schedulePoll() {
    const generation = this.generation;
    this.pollTimer = setTimeout(() => this.check(generation, false), POLL_MS);
  },

  /** 问一下码现在怎样了。due：到了换码的时间。 */
  async check(generation: number, due: boolean) {
    if (!this.visible || generation !== this.generation) {
      return;
    }
    let state: PayCodeState | null = null;
    try {
      state = await fetchPayCodeState(this.codeId);
    } catch {
      state = null;
    }
    if (!this.visible || generation !== this.generation) {
      return;
    }
    const step = nextStep(state, due);
    if (step.kind === 'used') {
      this.stopTimers();
      this.setData({ view: 'used', used: step.used });
      wx.vibrateShort({ type: 'medium', fail: noop });
      return;
    }
    if (step.kind === 'renew') {
      this.renew();
      return;
    }
    if (step.kind === 'scanned') {
      // 门店已经扫了：不再换码，免得扣款时找不到这张码。
      clearTimeout(this.refreshTimer);
      this.refreshTimer = 0;
      if (this.data.view !== 'scanned') {
        this.setData({ view: 'scanned', storeName: step.storeName });
      }
    }
    if (!due || step.kind === 'scanned') {
      this.schedulePoll();
    }
  },

  draw(code: string) {
    wx.createSelectorQuery()
      .select('#qr')
      .fields({ node: true, size: true })
      .exec((res: (CanvasHit | null)[]) => {
        const hit = res[0];
        if (!hit || !hit.node || code !== this.code) {
          return;
        }
        // 按真实像素画，格子边缘才清楚。
        const side = Math.round(hit.width * wx.getWindowInfo().pixelRatio);
        hit.node.width = side;
        hit.node.height = side;
        drawQr(hit.node.getContext('2d'), encodeDigits(code), side);
      });
  },

  onRefresh() {
    if (this.data.view === 'code') {
      this.renew();
    }
  },

  onRetry() {
    this.setData({ view: 'loading', message: '' });
    this.renew();
  },

  onDone() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  onViewEntry() {
    const used = this.data.used;
    if (used) {
      wx.redirectTo({ url: `/pages/ledger-detail/ledger-detail?id=${encodeURIComponent(used.entryId)}` });
    }
  },
});
