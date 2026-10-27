import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBool } from '../common/parse-bool';

export type SignTargetEnv = 'SANDBOX' | 'PRODUCTION';

export const ESIGN_SANDBOX_HOST = 'smlopenapi.esign.cn';
export const ESIGN_PRODUCTION_HOST = 'openapi.esign.cn';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface EsignTarget {
  env: SignTargetEnv;
  /** 不带末尾斜杠，例如 https://smlopenapi.esign.cn */
  baseUrl: string;
}

/** 环境或网关不允许调用。调用方转成 503，不打出任何请求。 */
export class EsignTargetRefusedError extends Error {}

/**
 * e签宝配置。
 * 配置项 esign.production.enabled ↔ 环境变量 ESIGN_PRODUCTION_ENABLED，默认 false。
 * 调用环境由网关地址决定：正式网关只在开关打开后允许，沙箱网关始终允许。
 */
@Injectable()
export class EsignConfigService {
  constructor(private readonly config: ConfigService) {}

  /** false 时不得走正式密钥、计费或对外正式签署。 */
  get productionEnabled(): boolean {
    return parseBool(this.config.get<string | boolean>('ESIGN_PRODUCTION_ENABLED'), false);
  }

  /** 未配置时使用沙箱主机，不回落到正式网关。 */
  get apiHost(): string {
    return this.config.get<string>('ESIGN_API_HOST') || `https://${ESIGN_SANDBOX_HOST}`;
  }

  get appId(): string {
    return this.config.get<string>('ESIGN_APP_ID')?.trim() ?? '';
  }

  get appSecret(): string {
    return this.config.get<string>('ESIGN_APP_SECRET')?.trim() ?? '';
  }

  get credentialsConfigured(): boolean {
    return this.appId.length > 0 && this.appSecret.length > 0;
  }

  /** e签宝回调地址，指向本服务的 POST /webhooks/esign。不配则只靠主动刷新。 */
  get notifyUrl(): string | null {
    return this.config.get<string>('ESIGN_NOTIFY_URL')?.trim() || null;
  }

  /** 会员签完后 H5 跳回的地址。不配则停在 e签宝的完成页。 */
  get redirectUrl(): string | null {
    return this.config.get<string>('ESIGN_REDIRECT_URL')?.trim() || null;
  }

  /**
   * 目标环境为 PRODUCTION 且总开关关闭时拒绝。
   * 默认（未传或 SANDBOX）在开关关闭时允许，表示调用方必须打沙箱。
   */
  assertSandboxUnlessEnabled(targetEnv: SignTargetEnv = 'SANDBOX'): void {
    if (targetEnv === 'PRODUCTION' && !this.productionEnabled) {
      throw new EsignTargetRefusedError(
        'esign.production.enabled is false; production signing is refused',
      );
    }
  }

  /**
   * 每次调用 e签宝前都要过这一道。
   * 正式网关 → PRODUCTION，必须开关打开；沙箱网关 → SANDBOX；
   * 本机地址只给测试和本地演示用的假沙箱，正式运行（NODE_ENV=production）不认。
   * 其他地址一律拒绝，避免 env=SANDBOX 却打到别处。
   */
  resolveTarget(): EsignTarget {
    let url: URL;
    try {
      url = new URL(this.apiHost);
    } catch {
      throw new EsignTargetRefusedError('ESIGN_API_HOST is not a valid url');
    }
    const host = url.hostname.toLowerCase();
    const baseUrl = url.origin;
    if (host === ESIGN_PRODUCTION_HOST) {
      this.assertSandboxUnlessEnabled('PRODUCTION');
      this.assertHttps(url);
      return { env: 'PRODUCTION', baseUrl };
    }
    if (host === ESIGN_SANDBOX_HOST) {
      this.assertHttps(url);
      return { env: 'SANDBOX', baseUrl };
    }
    if (LOOPBACK_HOSTS.has(host) && this.config.get<string>('NODE_ENV') !== 'production') {
      return { env: 'SANDBOX', baseUrl };
    }
    throw new EsignTargetRefusedError(`ESIGN_API_HOST ${host} is neither the e-sign sandbox nor production gateway`);
  }

  private assertHttps(url: URL): void {
    if (url.protocol !== 'https:') {
      throw new EsignTargetRefusedError('ESIGN_API_HOST must use https');
    }
  }
}
