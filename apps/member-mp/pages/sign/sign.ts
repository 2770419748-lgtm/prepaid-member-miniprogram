import { contractPdfPath, fetchSignFlow, fetchSignUrl, refreshSignFlow } from '../../utils/api';
import { ApiError, download, errorText } from '../../utils/request';
import { ensureLogin } from '../../utils/session';
import { SignDetail, toSignDetail } from '../../utils/sign';

Page({
  data: {
    loading: true,
    error: '',
    detail: null as SignDetail | null,
    agreed: false,
    opening: false,
    /** 刚从签署页回来并且签好了：显示成功页。 */
    success: false,
  },

  flowId: '',
  /** 打开了签署页，回来时要向电子签平台核对一次。 */
  returning: false,

  onLoad(options: Record<string, string | undefined>) {
    this.flowId = decodeURIComponent(options.id ?? '');
  },

  onShow() {
    if (!ensureLogin()) {
      return;
    }
    if (this.returning) {
      this.returning = false;
      this.syncAfterSign();
    } else if (!this.data.detail) {
      this.load();
    }
  },

  async load() {
    if (!this.flowId) {
      this.setData({ loading: false, error: '没有找到这份权益单' });
      return;
    }
    try {
      const flow = await fetchSignFlow(this.flowId);
      this.setData({ loading: false, error: '', detail: toSignDetail(flow) });
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },

  retry() {
    this.setData({ loading: true, error: '' });
    this.load();
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  async openSign() {
    if (this.data.opening) {
      return;
    }
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选「我已阅读以上权益内容」', icon: 'none' });
      return;
    }
    this.setData({ opening: true });
    try {
      // 签署链接有时效，每次打开前现取。
      const { signUrl } = await fetchSignUrl(this.flowId);
      this.returning = true;
      wx.navigateTo({ url: `/pages/sign-webview/sign-webview?url=${encodeURIComponent(signUrl)}` });
    } catch (error) {
      wx.showToast({ title: errorText(error), icon: 'none' });
      // 409：已经签完、过期或被撤销了，按最新状态重新显示。
      if (error instanceof ApiError && error.status === 409) {
        this.load();
      }
    } finally {
      this.setData({ opening: false });
    }
  },

  async syncAfterSign() {
    wx.showLoading({ title: '正在核对签署结果', mask: true });
    try {
      const detail = toSignDetail(await refreshSignFlow(this.flowId));
      wx.hideLoading();
      this.setData({ loading: false, error: '', detail, success: detail.status === 'SIGNED' });
      if (detail.status === 'PENDING') {
        wx.showToast({ title: '还没签完，可以继续签署', icon: 'none' });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: errorText(error), icon: 'none' });
      this.load();
    }
  },

  async viewContract() {
    wx.showLoading({ title: '正在打开合同', mask: true });
    try {
      const filePath = await download(contractPdfPath(this.flowId));
      wx.hideLoading();
      wx.openDocument({ filePath, fileType: 'pdf', showMenu: true });
    } catch (error) {
      wx.hideLoading();
      const missing = error instanceof ApiError && error.status === 404;
      wx.showToast({ title: missing ? '合同还在归档，请稍后再试' : errorText(error), icon: 'none' });
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});
