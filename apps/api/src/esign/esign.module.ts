import { Module } from '@nestjs/common';

/**
 * 电子签业务边界。
 * TODO(M4): 模板、签署流程与回写。调用前必须走 EsignConfigService.assertSandboxUnlessEnabled。
 * ESIGN_PRODUCTION_ENABLED 默认 false。未打开时不得使用正式密钥或对外正式签署。
 * 本里程碑不接通 e签宝真实 API。
 */
@Module({})
export class EsignModule {}
