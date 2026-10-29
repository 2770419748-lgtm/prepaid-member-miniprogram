import { UnauthorizedException } from '@nestjs/common';
import { randomInt } from 'crypto';

/** 测试里替代微信换手机号接口：code 对应哪个手机号由测试自己绑定。 */
export class FakeWechat {
  readonly byCode = new Map<string, { phone: string; openId: string; unionId: string | null; countryCode: string }>();

  exchange(input: { code: string }) {
    const found = this.byCode.get(input.code);
    if (!found) {
      return Promise.reject(new UnauthorizedException('微信登录失败'));
    }
    return Promise.resolve(found);
  }

  /** 会员小程序码要用的接口调用凭证。 */
  readonly accessToken = async (): Promise<string> => 'fake-access-token';

  forgetAccessToken(): void {}

  base(): string {
    return 'https://api.weixin.example.invalid';
  }

  bind(code: string, phone: string): void {
    this.byCode.set(code, {
      phone,
      openId: `openid-${phone}`,
      unionId: null,
      countryCode: '86',
    });
  }
}

export function randomPhone(): string {
  return `13${randomInt(100000000, 1000000000).toString()}`;
}

export function messageOf(body: { message?: unknown }): string {
  return typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
}
