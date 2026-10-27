/**
 * 接口地址按小程序版本区分。开发版连本机接口；体验版和正式版等部署时再填，现在不部署。
 * 真机预览时把 develop 改成电脑的局域网地址，并在开发者工具里勾选「不校验合法域名」。
 */
const API_BASE: Record<string, string> = {
  develop: 'http://127.0.0.1:3000',
  trial: '',
  release: '',
};

export function envVersion(): string {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return 'release';
  }
}

export function apiBase(): string {
  return API_BASE[envVersion()] ?? '';
}

/**
 * 开发版的假手机号登录：在开发者工具的 Storage 里加一项 dev_mock_phone（如 13800138000）。
 * 只有开发版会带上，接口也只在开发环境、打开 WECHAT_PHONE_MOCK 时才认。
 */
export function devMockPhone(): string | null {
  if (envVersion() !== 'develop') {
    return null;
  }
  const value: unknown = wx.getStorageSync('dev_mock_phone');
  return typeof value === 'string' && /^1\d{10}$/.test(value) ? value : null;
}
