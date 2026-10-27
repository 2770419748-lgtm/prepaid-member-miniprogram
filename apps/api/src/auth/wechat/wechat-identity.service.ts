import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { WxPhoneLoginDto } from '../dto/wx-phone-login.dto';
import { assertMainlandMobile, normalizePhone } from '../phone';
import { WechatAppConfig, WechatAppKind } from './wechat-app.config';
import { WechatPhoneClient } from './wechat-phone.client';

export interface PhoneIdentity {
  phone: string;
  openId: string;
  unionId: string | null;
}

@Injectable()
export class WechatIdentityService {
  constructor(
    private readonly apps: WechatAppConfig,
    private readonly client: WechatPhoneClient,
  ) {}

  async resolve(kind: WechatAppKind, dto: WxPhoneLoginDto): Promise<PhoneIdentity> {
    if (this.apps.mockEnabled && dto.mockPhone) {
      const phone = normalizePhone(dto.mockPhone);
      assertMainlandMobile(phone);
      return {
        phone,
        openId: dto.mockOpenId?.trim() || `mock:${kind}:${phone}`,
        unionId: dto.mockUnionId?.trim() || null,
      };
    }

    const credentials = this.apps.credentials(kind);
    const exchanged = await this.client.exchange({
      appId: credentials.appId,
      secret: credentials.secret,
      code: dto.code,
      phoneCode: dto.phoneCode,
    });
    if (exchanged.countryCode !== '86') {
      throw new BadRequestException('仅支持中国大陆手机号');
    }
    const phone = normalizePhone(exchanged.phone);
    assertMainlandMobile(phone);
    if (!exchanged.openId) {
      throw new UnauthorizedException('微信登录失败');
    }
    return {
      phone,
      openId: exchanged.openId,
      unionId: exchanged.unionId,
    };
  }
}
