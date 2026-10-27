import { API_BASE, DEV_STORAGE_KEYS } from '../config';

function isDevelop(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
  } catch {
    return false;
  }
}

function devSetting(key: string): string {
  if (!isDevelop()) {
    return '';
  }
  const value: unknown = wx.getStorageSync(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function apiBase(): string {
  return (devSetting(DEV_STORAGE_KEYS.apiBase) || API_BASE).replace(/\/+$/, '');
}

/** 开发版的假手机号。体验版、正式版永远为空。 */
export function devMockPhone(): string {
  return devSetting(DEV_STORAGE_KEYS.mockPhone);
}
