import { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** 一个网页来源：协议 + 域名 [+ 端口]，不带路径。 */
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export interface ExposureSettings {
  /** NODE_ENV=production。 */
  production: boolean;
  /** CORS_ORIGINS 原文：允许跨域调用接口的网页来源，逗号分隔。 */
  corsOrigins: string | undefined;
}

/**
 * 哪些网页能跨域调接口。小程序的请求不受跨域限制，这里只管浏览器里的商家后台。
 * 正式环境只认 CORS_ORIGINS 里列出的来源，不许写 *；没配就不允许任何跨域网页调用。
 * 开发和测试环境没配时放开，方便本机 vite 调试。
 */
export function resolveCorsOrigins(raw: string | undefined, production: boolean): string[] | true {
  const origins = (raw ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item.length > 0);
  if (origins.length === 0) {
    return production ? [] : true;
  }
  if (origins.includes('*')) {
    if (production) {
      throw new Error('CORS_ORIGINS 不能写 *，正式环境只能列出商家后台的网址，例如 https://admin.example.com');
    }
    return true;
  }
  const invalid = origins.filter((item) => !ORIGIN.test(item));
  if (invalid.length > 0) {
    throw new Error(`CORS_ORIGINS 格式不对：${invalid.join('、')}。只写协议和域名，例如 https://admin.example.com`);
  }
  return origins;
}

function corsOptions(origins: string[] | true): CorsOptions {
  if (origins === true) {
    return { origin: true };
  }
  // 名单为空时 origin=false：不回任何跨域许可头，浏览器里的网页都调不了。
  return { origin: origins.length > 0 ? origins : false };
}

function mountApiDocs(app: INestApplication): void {
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
}

/**
 * 对外暴露什么：跨域许可、接口文档。正式环境收紧，开发和测试环境照旧。
 * 返回实际生效的设置，启动时打日志用。配置不合格直接抛错，接口不启动。
 */
export function configureExposure(
  app: INestApplication,
  settings: ExposureSettings,
): { corsOrigins: string[] | true; docs: boolean } {
  const corsOrigins = resolveCorsOrigins(settings.corsOrigins, settings.production);
  app.enableCors(corsOptions(corsOrigins));
  // 接口文档会把所有接口和字段列出来，正式环境不挂。
  const docs = !settings.production;
  if (docs) {
    mountApiDocs(app);
  }
  return { corsOrigins, docs };
}
