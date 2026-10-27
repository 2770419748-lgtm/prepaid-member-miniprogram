import { pickStore } from './ledger';
import type { MemberCard, MyStore, MyStoresResult, StaffLoginResult, StaffProfile } from './types';

/**
 * 登录状态存在本机缓存里：登录凭证、员工资料、能操作的门店和当前门店。
 * 记账时用的门店就是「当前门店」，换店在「我的」或工作台顶部切换。
 */
export interface Session {
  token: string;
  expiresAt: number;
  staff: StaffProfile;
  access: MyStoresResult;
  storeId: string | null;
}

export interface RecentMember {
  id: string;
  phone: string;
  name: string | null;
}

const SESSION_KEY = 'staff.session';
const RECENT_KEY = 'staff.recentMembers';
const RECENT_LIMIT = 5;

export const LOGIN_PAGE = '/pages/login/login';

export function loadSession(): Session | null {
  const value = wx.getStorageSync(SESSION_KEY) as Session | '';
  if (!value || !value.token || value.expiresAt <= Date.now()) {
    return null;
  }
  return value;
}

export function saveLogin(login: StaffLoginResult, access: MyStoresResult): Session {
  const session: Session = {
    token: login.accessToken,
    // 提前一分钟当作过期，避免提交到一半凭证失效。
    expiresAt: Date.now() + (login.expiresIn - 60) * 1000,
    staff: login.staff,
    access,
    storeId: pickStore(access.stores, null)?.id ?? null,
  };
  wx.setStorageSync(SESSION_KEY, session);
  return session;
}

/** 门店有变动（新开、停用、角色调整）时刷新，保留当前门店的选择。 */
export function saveAccess(access: MyStoresResult): Session | null {
  const session = loadSession();
  if (!session) {
    return null;
  }
  session.access = access;
  session.storeId = pickStore(access.stores, session.storeId)?.id ?? null;
  wx.setStorageSync(SESSION_KEY, session);
  return session;
}

export function switchStore(storeId: string): void {
  const session = loadSession();
  if (session && pickStore(session.access.stores, storeId)?.id === storeId) {
    session.storeId = storeId;
    wx.setStorageSync(SESSION_KEY, session);
  }
}

export function currentStore(session: Session): MyStore | null {
  return pickStore(session.access.stores, session.storeId);
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY);
  wx.removeStorageSync(RECENT_KEY);
}

/** 没登录就回登录页。页面在 onShow 里调用，拿到空值时直接 return。 */
export function requireSession(): Session | null {
  const session = loadSession();
  if (!session) {
    wx.reLaunch({ url: LOGIN_PAGE });
  }
  return session;
}

/** 工作台「最近查过」：同一位员工最近办理过的 5 位会员，方便连续办理。 */
export function recentMembers(): RecentMember[] {
  const value = wx.getStorageSync(RECENT_KEY) as RecentMember[] | '';
  return Array.isArray(value) ? value : [];
}

export function rememberMember(member: Pick<MemberCard, 'id' | 'phone' | 'name'>): void {
  const next = [
    { id: member.id, phone: member.phone, name: member.name },
    ...recentMembers().filter((item) => item.id !== member.id),
  ].slice(0, RECENT_LIMIT);
  wx.setStorageSync(RECENT_KEY, next);
}
