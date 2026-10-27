import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBool } from '../common/parse-bool';

export type SignTargetEnv = 'SANDBOX' | 'PRODUCTION';

/**
 * e签宝配置骨架。M0 只读开关，不调用真实签署 API。
 * 配置项 esign.production.enabled ↔ 环境变量 ESIGN_PRODUCTION_ENABLED，默认 false。
 */
@Injectable()
export class EsignConfigService {
  constructor(private readonly config: ConfigService) {}

  /** false 时不得走正式密钥、计费或对外正式签署。 */
  get productionEnabled(): boolean {
    return parseBool(this.config.get<string | boolean>('ESIGN_PRODUCTION_ENABLED'), false);
  }

  /** 沙箱网关占位。未配置时使用沙箱主机，不回落到正式网关。 */
  get apiHost(): string {
    return this.config.get<string>('ESIGN_API_HOST') || 'https://smlopenapi.esign.cn';
  }

  /**
   * 目标环境为 PRODUCTION 且总开关关闭时拒绝。
   * 默认（未传或 SANDBOX）在开关关闭时允许，表示调用方必须打沙箱。
   */
  assertSandboxUnlessEnabled(targetEnv: SignTargetEnv = 'SANDBOX'): void {
    if (targetEnv === 'PRODUCTION' && !this.productionEnabled) {
      throw new Error(
        'esign.production.enabled is false; production signing is refused',
      );
    }
  }
}
