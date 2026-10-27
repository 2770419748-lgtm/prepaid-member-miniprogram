import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatFetch, WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';

function clientWith(fetchImpl: WechatFetch): WechatPhoneClient {
  const config = { get: () => undefined } as unknown as ConfigService;
  const client = new WechatPhoneClient(config);
  client.fetchImpl = fetchImpl;
  return client;
}

describe('WechatPhoneClient', () => {
  const secret = 'super-secret-value';

  it('reads the phone number without leaking the secret', async () => {
    const urls: string[] = [];
    const client = clientWith(async (url) => {
      urls.push(url);
      if (url.includes('/sns/jscode2session')) {
        return { ok: true, status: 200, json: async () => ({ openid: 'oid', unionid: 'uid' }) };
      }
      if (url.includes('/cgi-bin/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 7200 }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ phone_info: { purePhoneNumber: '13800138000', countryCode: '86' } }),
      };
    });

    const result = await client.exchange({
      appId: 'app',
      secret,
      code: 'login-code',
      phoneCode: 'phone-code',
    });

    expect(result).toEqual({
      phone: '13800138000',
      countryCode: '86',
      openId: 'oid',
      unionId: 'uid',
    });
    expect(urls[0]).toContain('/sns/jscode2session');
    expect(urls.some((url) => url.includes(secret))).toBe(true);
  });

  it('caches the access token', async () => {
    let tokenCalls = 0;
    const client = clientWith(async (url) => {
      if (url.includes('/sns/jscode2session')) {
        return { ok: true, status: 200, json: async () => ({ openid: 'oid' }) };
      }
      if (url.includes('/cgi-bin/token')) {
        tokenCalls += 1;
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 7200 }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ phone_info: { purePhoneNumber: '13800138000', countryCode: 86 } }),
      };
    });
    const input = { appId: 'app', secret, code: 'c', phoneCode: 'p' };
    await client.exchange(input);
    await client.exchange(input);
    expect(tokenCalls).toBe(1);
  });

  it('hides upstream errors and the secret', async () => {
    const client = clientWith(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 40029, errmsg: `bad ${secret}` }),
    }));
    await expect(
      client.exchange({ appId: 'app', secret, code: 'c', phoneCode: 'p' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    try {
      await client.exchange({ appId: 'app', secret, code: 'c', phoneCode: 'p' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(error).toBeInstanceOf(UnauthorizedException);
    }
  });

  it('turns network failures into a gateway error without the secret', async () => {
    const client = clientWith(async () => {
      throw new Error(`connect ${secret}`);
    });
    await expect(
      client.exchange({ appId: 'app', secret, code: 'c', phoneCode: 'p' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
