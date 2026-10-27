import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { WechatAppConfig } from './auth/wechat/wechat-app.config';
import { configureApp } from './configure-app';
import { EsignConfigService } from './esign-config/esign-config.service';

async function bootstrap(): Promise<void> {
  // rawBody：e签宝回调要用原始请求体验签。
  const app = await NestFactory.create(AppModule, { cors: true, rawBody: true });
  configureApp(app);

  const swagger = new DocumentBuilder()
    .setTitle('储值会员')
    .setDescription('账号、门店与员工。不做小程序内支付。正式签署默认关闭。')
    .setVersion('1')
    .addBearerAuth()
    .addTag('登录')
    .addTag('门店')
    .addTag('员工')
    .addTag('会员')
    .addTag('权益单')
    .addTag('健康检查')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    customSiteTitle: '储值会员接口',
    swaggerOptions: {
      docExpansion: 'list',
      defaultModelsExpandDepth: -1,
      persistAuthorization: true,
    },
  });

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

void bootstrap();
