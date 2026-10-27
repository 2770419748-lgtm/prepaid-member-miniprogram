/** 正式环境 JWT 密钥至少多长。随机生成的 32 字节以上，猜不出来。 */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** 仓库里出现过的示例、测试和 CI 用的密钥。谁都能看到，正式环境不能用。 */
const PUBLIC_SECRETS = new Set([
  'change-me-in-local-only',
  'test-only-jwt-secret',
  'ci-only-jwt-secret',
  'test-secret',
]);

/**
 * 读登录凭证的签名密钥。没配就不启动。
 * 正式环境（NODE_ENV=production）还要求够长、不是仓库里的示例值，否则不启动。原因只说哪条不符合，不打印密钥本身。
 */
export function resolveJwtSecret(raw: string | undefined, nodeEnv: string | undefined): string {
  const secret = raw?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET 没有配置，接口不能启动');
  }
  if (nodeEnv !== 'production') {
    return secret;
  }
  if (PUBLIC_SECRETS.has(secret) || /change-?me/i.test(secret)) {
    throw new Error('JWT_SECRET 还是仓库里的示例值，正式环境必须换成随机生成的密钥（例如 openssl rand -base64 48）');
  }
  if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET 太短（${secret.length} 位），正式环境至少 ${MIN_PRODUCTION_SECRET_LENGTH} 位（例如 openssl rand -base64 48）`,
    );
  }
  return secret;
}
