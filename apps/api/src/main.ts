import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WechatAppConfig } from './auth/wechat/wechat-app.config';
import { configureApp } from './configure-app';
import { EsignConfigService } from './esign-config/esign-config.service';
import { configureExposure } from './http-exposure';

async function bootstrap(): Promise<void> {
  // rawBody：e签宝回调要用原始请求体验签。
  // abortOnError=false：启动检查（例如正式环境的 JWT 密钥）不通过时把原因抛出来，由下面打印后退出。
  const app = await NestFactory.create(AppModule, { rawBody: true, abortOnError: false });
  configureApp(app);

  const config = app.get(ConfigService);
  const production = config.get<string>('NODE_ENV') === 'production';
  const { corsOrigins, docs } = configureExposure(app, {
    production,
    corsOrigins: config.get<string>('CORS_ORIGINS'),
  });
  if (corsOrigins === true) {
    Logger.log('cors.origins=任意网页（开发环境）', 'Bootstrap');
  } else if (corsOrigins.length === 0) {
    Logger.warn('CORS_ORIGINS 没有配置：浏览器里的商家后台不能跨域调接口。后台和接口不同域名时要配置。', 'Bootstrap');
  } else {
    Logger.log(`cors.origins=${corsOrigins.join(',')}`, 'Bootstrap');
  }
  Logger.log(`docs=${docs ? '/docs' : '正式环境不开放'}`, 'Bootstrap');

  const esign = app.get(EsignConfigService);
  const wechat = app.get(WechatAppConfig);
  Logger.log(`esign.production.enabled=${esign.productionEnabled}`, 'Bootstrap');
  try {
    Logger.log(`esign.target=${esign.resolveTarget().env}`, 'Bootstrap');
  } catch (error) {
    Logger.warn(`电子签网关配置被拒绝：${error instanceof Error ? error.message : 'unknown'}`, 'Bootstrap');
  }
  Logger.log(`wechat.phoneMock=${wechat.mockEnabled}`, 'Bootstrap');
  if (wechat.mockEnabled) {
    Logger.warn('微信假手机号已打开，只用于开发演示。NODE_ENV=production 时会强制关闭。', 'Bootstrap');
  }

  const port = Number(process.env.API_PORT || 3000);
  await app.listen(port);
  Logger.log(`api listening on ${port}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(`接口没有启动：${error instanceof Error ? error.message : String(error)}`, 'Bootstrap');
  process.exit(1);
});
