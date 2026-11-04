import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBool } from '../../common/parse-bool';

/**
 * 会员和员工共用一个小程序（2026-11-04 合并），只有一套 AppID 和密钥：
 * `WECHAT_MEMBER_APPID`、`WECHAT_MEMBER_SECRET`（沿用原会员小程序的配置名，不用改 .env）。
 * 假手机号只允许开发演示，正式环境强制关闭。
 */
@Injectable()
export class WechatAppConfig {
  constructor(private readonly config: ConfigService) {}

  get mockEnabled(): boolean {
    if ((process.env.NODE_ENV ?? '') === 'production') {
      return false;
    }
    return parseBool(this.config.get<string | boolean>('WECHAT_PHONE_MOCK'), false);
  }

  credentials(): { appId: string; secret: string } {
    const appId = (this.config.get<string>('WECHAT_MEMBER_APPID') ?? '').trim();
    const secret = (this.config.get<string>('WECHAT_MEMBER_SECRET') ?? '').trim();
    if (!appId || !secret) {
      throw new ServiceUnavailableException('微信登录未配置');
    }
    return { appId, secret };
  }
}
