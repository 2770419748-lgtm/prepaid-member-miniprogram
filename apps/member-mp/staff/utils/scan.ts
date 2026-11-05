import { checkOrder, scanPayCode } from './api';
import { messageOf } from './errors';
import { cleanScanned } from './paycode';
import { readScannedOrder, readTypedOrder } from './sale-order';
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

/**
 * 打开摄像头扫九讯云小票上的订单条码（只扫条形码，不扫二维码），再问服务端这张单抵过没有。
 * 取消扫码返回空；扫错了码、单已经抵过时弹窗说明，也返回空。
 */
export async function scanSaleOrder(): Promise<string | null> {
  let raw = '';
  try {
    raw = (await wx.scanCode({ onlyFromCamera: true, scanType: ['barCode'] })).result;
  } catch {
    return null;
  }
  const read = readScannedOrder(raw);
  if (!read.ok) {
    await wx.showModal({ title: '没有扫到订单码', content: read.reason, showCancel: false, confirmText: '知道了' });
    return null;
  }
  return confirmUnusedOrder(read.orderNo);
}

/** 手输的单号，同样先查抵过没有。格式不对返回提示文字，交给页面显示在输入框下面。 */
export async function useTypedOrder(input: string): Promise<{ orderNo: string } | { reason: string } | null> {
  const read = readTypedOrder(input);
  if (!read.ok) {
    return { reason: read.reason };
  }
  const orderNo = await confirmUnusedOrder(read.orderNo);
  return orderNo ? { orderNo } : null;
}

async function confirmUnusedOrder(orderNo: string): Promise<string | null> {
  wx.showLoading({ title: '正在查这张单', mask: true });
  try {
    const checked = await checkOrder(orderNo);
    wx.hideLoading();
    if (checked.redeemed) {
      await wx.showModal({
        title: '这张单不能再抵',
        content: checked.message ?? '这张单已经抵扣过了',
        showCancel: false,
        confirmText: '知道了',
      });
      return null;
    }
    return checked.orderNo;
  } catch (error) {
    wx.hideLoading();
    await wx.showModal({ title: '没有查到这张单', content: messageOf(error), showCancel: false, confirmText: '知道了' });
    return null;
  }
}
