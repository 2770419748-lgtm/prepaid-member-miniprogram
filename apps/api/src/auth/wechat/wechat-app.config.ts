import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBool } from '../../common/parse-bool';

export type WechatAppKind = 'member' | 'staff';

/**
 * 会员端和店员端可以各用一套测试号。
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

  credentials(kind: WechatAppKind): { appId: string; secret: string } {
    const appIdKey = kind === 'member' ? 'WECHAT_MEMBER_APPID' : 'WECHAT_STAFF_APPID';
    const secretKey = kind === 'member' ? 'WECHAT_MEMBER_SECRET' : 'WECHAT_STAFF_SECRET';
    const appId = (this.config.get<string>(appIdKey) ?? '').trim();
    const secret = (this.config.get<string>(secretKey) ?? '').trim();
    if (!appId || !secret) {
      throw new ServiceUnavailableException('微信登录未配置');
    }
    return { appId, secret };
  }
}
