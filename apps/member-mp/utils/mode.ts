/**
 * 会员和员工共用这一个小程序（2026-11-04 合并）。
 *
 * - 会员页：pages/ 下的首页、明细、我的……底部是小程序自带的 tabBar。
 * - 工作台：staff/ 目录下的页面，只有在职员工能用，底部是工作台自己的三栏（工作台、本店流水、我的）。
 *
 * 登录页用微信手机号一键登录，服务端认出是在职员工就给员工登录，直接进工作台；其他人进会员页。
 * 两边的登录分开存（会员在 utils/session.ts，员工在 staff/utils/session.ts）。员工在工作台点「切到我的会员卡」后两张都在，
 * 这里记住现在用的是哪一边，下次打开小程序回到同一边。权限一律由服务端按登录判断，这里只管去哪个页面。
 */
import { clearSession as clearMemberSession, currentToken } from './session';
import { clearSession as clearStaffSession, loadSession as loadStaffSession } from '../staff/utils/session';

export type AppMode = 'member' | 'staff';

const MODE_KEY = 'app_mode';

export const LOGIN_PAGE = '/pages/login/login';
export const MEMBER_HOME = '/pages/index/index';
export const WORKBENCH = '/staff/pages/index/index';

export function currentMode(): AppMode {
  const value: unknown = wx.getStorageSync(MODE_KEY);
  return value === 'staff' ? 'staff' : 'member';
}

export function setMode(mode: AppMode): void {
  wx.setStorageSync(MODE_KEY, mode);
}

export type Landing = 'staff' | 'member' | 'login';

/**
 * 打开小程序（或回到登录页）时去哪：先回上次用的那一边；那一边的登录没了就去另一边；都没有才登录。
 * 员工被停用后员工登录失效，有会员登录的就只剩会员页。
 */
export function landingFor(state: { mode: AppMode; hasStaff: boolean; hasMember: boolean }): Landing {
  if (state.mode === 'staff' && state.hasStaff) return 'staff';
  if (state.mode === 'member' && state.hasMember) return 'member';
  if (state.hasStaff) return 'staff';
  if (state.hasMember) return 'member';
  return 'login';
}

export function currentLanding(): Landing {
  return landingFor({ mode: currentMode(), hasStaff: Boolean(loadStaffSession()), hasMember: Boolean(currentToken()) });
}

/** 本机有没有还有效的员工登录（会员「我的」页据此显示「回到工作台」）。 */
export function hasStaffLogin(): boolean {
  return Boolean(loadStaffSession());
}

export function openWorkbench(): void {
  setMode('staff');
  wx.reLaunch({ url: WORKBENCH });
}

export function openMemberHome(): void {
  setMode('member');
  wx.reLaunch({ url: MEMBER_HOME });
}

/** 退出登录：会员和员工的登录一起清掉，回到登录页。 */
export function signOut(): void {
  clearMemberSession();
  clearStaffSession();
  wx.removeStorageSync(MODE_KEY);
  wx.reLaunch({ url: LOGIN_PAGE });
}
