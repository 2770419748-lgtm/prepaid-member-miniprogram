/** 将环境变量解析为布尔。空值使用 fallback。无法识别的字符串也回落到 fallback。 */
export function parseBool(
  value: string | boolean | undefined | null,
  fallback: boolean,
): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}
