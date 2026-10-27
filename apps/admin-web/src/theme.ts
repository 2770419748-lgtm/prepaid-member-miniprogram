/** 设计规范 v1.1 的色板、圆角，映射到 Ant Design Vue 的主题变量。 */
export const palette = {
  primary: '#1677FF',
  primaryDark: '#0958D9',
  text: '#0F172A',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  pageBg: '#F8FAFC',
  cardBg: '#FFFFFF',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
} as const;

export const theme = {
  token: {
    colorPrimary: palette.primary,
    colorInfo: palette.primary,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorBorderSecondary: palette.border,
    colorBgLayout: palette.pageBg,
    colorBgContainer: palette.cardBg,
    borderRadius: 8,
    borderRadiusLG: 12,
    fontSize: 14,
  },
};
