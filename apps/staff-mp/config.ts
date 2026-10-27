/**
 * 接口地址。真机预览和上线前改成正式域名（须在小程序后台配置为 request 合法域名）。
 * 本仓库不部署任何对外环境，这里默认指向本机服务。
 */
export const API_BASE = 'http://localhost:3000';

/**
 * 只在开发版（微信开发者工具）里读取的本地演示设置，存在本地缓存里，界面上没有入口：
 * - `dev.apiBase`：换一个接口地址。
 * - `dev.mockPhone`：用假手机号登录。服务端还必须打开 `WECHAT_PHONE_MOCK`，正式环境不生效。
 */
export const DEV_STORAGE_KEYS = {
  apiBase: 'dev.apiBase',
  mockPhone: 'dev.mockPhone',
} as const;
