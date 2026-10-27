import { scanPayCode } from './api';
import { messageOf } from './errors';
import { cleanScanned } from './paycode';
import type { ScannedPayCode } from './types';

export interface ScannedMember extends ScannedPayCode {
  /** 扫到的会员码，消费提交时带上。 */
  code: string;
}

/**
 * 打开摄像头扫顾客出示的会员码，再交给服务端认码。
 * 只能用摄像头扫，不能从相册选图。取消扫码返回空；
 * 扫到的不是会员码、码过期或已经用过时弹窗说明原因，也返回空。
 */
export async function scanMemberCode(storeId: string): Promise<ScannedMember | null> {
  let raw = '';
  try {
    raw = (await wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'] })).result;
  } catch {
    return null;
  }
  const code = cleanScanned(raw);
  wx.showLoading({ title: '正在识别会员码', mask: true });
  try {
    const scanned = await scanPayCode(code, storeId);
    wx.hideLoading();
    return { ...scanned, code };
  } catch (error) {
    wx.hideLoading();
    await wx.showModal({ title: '扫码没有成功', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    return null;
  }
}
