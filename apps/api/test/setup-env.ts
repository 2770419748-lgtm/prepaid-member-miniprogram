import 'reflect-metadata';

process.env.DATABASE_URL ??=
  'postgresql://prepaid:prepaid@localhost:5432/prepaid_member?schema=public';
process.env.JWT_SECRET ??= 'test-only-jwt-secret';
process.env.JWT_EXPIRES_IN ??= '12h';
process.env.ESIGN_PRODUCTION_ENABLED ??= 'false';
process.env.WECHAT_PHONE_MOCK ??= 'false';
