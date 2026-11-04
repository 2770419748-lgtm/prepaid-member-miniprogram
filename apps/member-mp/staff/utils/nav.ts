import { WORKBENCH } from '../../utils/mode';

/**
 * 工作台的三栏（工作台、本店流水、我的）。会员和员工共用一个小程序，小程序自带的 tabBar 留给会员页，
 * 工作台这三页底部画自己的一栏，点了用 reLaunch 换页（页面栈只留一页，跟 tabBar 一样没有返回）。
 */
export type StaffTab = 'index' | 'ledger' | 'mine';

export function staffTabUrl(tab: StaffTab): string {
  return `/staff/pages/${tab}/${tab}`;
}

export function switchStaffTab(tab: StaffTab): void {
  wx.reLaunch({ url: staffTabUrl(tab) });
}

/** 回工作台首页（办完一笔、稍后再签等）。 */
export function goWorkbench(): void {
  wx.reLaunch({ url: WORKBENCH });
}

/**
 * 工作台三页是 reLaunch 打开的，不是小程序的第一页，微信会在左上角放一个「回首页」的小房子，点了会去登录页再绕回来。
 * 这三页本来就是首页，把它藏起来。
 */
export function hideHomeButton(): void {
  if (typeof wx.hideHomeButton === 'function') {
    wx.hideHomeButton({ fail: () => undefined });
  }
}
