import { ConfigService } from '@nestjs/config';
import { WechatAppConfig } from '../src/auth/wechat/wechat-app.config';
import { WechatIdentityService } from '../src/auth/wechat/wechat-identity.service';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';

function configReturning(values: Record<string, string | boolean>): ConfigService {
  return {
    get: (key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined),
  } as unknown as ConfigService;
}

describe('WechatAppConfig mock switch', () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previous;
  });

  it('defaults to off', () => {
    process.env.NODE_ENV = 'test';
    expect(new WechatAppConfig(configReturning({})).mockEnabled).toBe(false);
  });

  it('can be turned on outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(new WechatAppConfig(configReturning({ WECHAT_PHONE_MOCK: 'true' })).mockEnabled).toBe(true);
  });

  it('stays off in production even when the flag is true', () => {
    process.env.NODE_ENV = 'production';
    expect(new WechatAppConfig(configReturning({ WECHAT_PHONE_MOCK: 'true' })).mockEnabled).toBe(false);
  });
});

describe('WechatIdentityService', () => {
  it('ignores a fake phone when the mock switch is off', async () => {
    const client = {
      exchange: jest.fn().mockResolvedValue({
        phone: '13900000000',
        openId: 'real-open',
        unionId: null,
        countryCode: '86',
      }),
    };
    const apps = {
      mockEnabled: false,
      credentials: () => ({ appId: 'app', secret: 'secret' }),
    };
    const service = new WechatIdentityService(
      apps as unknown as WechatAppConfig,
      client as unknown as WechatPhoneClient,
    );

    const identity = await service.resolve('member', {
      code: 'login-code',
      phoneCode: 'phone-code',
      mockPhone: '13800138000',
    });

    expect(identity.phone).toBe('13900000000');
    expect(identity.openId).toBe('real-open');
    expect(client.exchange).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'login-code', phoneCode: 'phone-code' }),
    );
  });

  it('uses the fake phone only when the mock switch is on', async () => {
    const client = { exchange: jest.fn() };
    const apps = { mockEnabled: true, credentials: jest.fn() };
    const service = new WechatIdentityService(
      apps as unknown as WechatAppConfig,
      client as unknown as WechatPhoneClient,
    );

    await expect(
      service.resolve('staff', {
        code: 'login-code',
        phoneCode: 'phone-code',
        mockPhone: '+86 138-0013-8000',
      }),
    ).resolves.toMatchObject({ phone: '13800138000', openId: 'mock:staff:13800138000' });
    expect(client.exchange).not.toHaveBeenCalled();
    expect(apps.credentials).not.toHaveBeenCalled();
  });
});
