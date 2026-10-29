import { ConfigService } from '@nestjs/config';
import { WechatAppConfig } from '../src/auth/wechat/wechat-app.config';
import { WechatPhoneClient } from '../src/auth/wechat/wechat-phone.client';
import { AppCodeFetch, MemberAppCodeService } from '../src/member-app/member-app-code.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function setup(values: Record<string, string>, codeFetch: AppCodeFetch) {
  const config = configWith(values);
  const wechat = new WechatPhoneClient(config);
  let tokenCalls = 0;
  wechat.fetchImpl = async () => {
    tokenCalls += 1;
    return { ok: true, status: 200, json: async () => ({ access_token: `tok${tokenCalls}`, expires_in: 7200 }) };
  };
  const service = new MemberAppCodeService(config, new WechatAppConfig(config), wechat);
  service.fetchImpl = codeFetch;
  return { service, tokenCalls: () => tokenCalls };
}

function image(bytes: Buffer, type = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? type : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
  };
}

function json(body: object) {
  return image(Buffer.from(JSON.stringify(body)), 'application/json; charset=UTF-8');
}

const configured = {
  WECHAT_MEMBER_APPID: 'member-app',
  WECHAT_MEMBER_SECRET: 'member-secret-value',
};

describe('member mini program code', () => {
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('asks WeChat for an unlimited code of the member home page and caches it', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const { service, tokenCalls } = setup({ ...configured, WECHAT_MEMBER_CODE_ENV: 'trial' }, async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return image(PNG, 'image/png');
    });
    const first = await service.code();
    const second = await service.code();
    expect(first).toEqual({ image: `data:image/png;base64,${PNG.toString('base64')}`, demo: false, message: null });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(tokenCalls()).toBe(1);
    expect(calls[0].url).toContain('/wxa/getwxacodeunlimit?access_token=tok1');
    expect(calls[0].body).toMatchObject({ page: 'pages/index/index', check_path: false, env_version: 'trial' });
    expect(String(calls[0].body.scene).length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(calls)).not.toContain('member-secret-value');
  });

  it('gets a new access token once when WeChat says the old one expired', async () => {
    let attempts = 0;
    const { service, tokenCalls } = setup(configured, async (url) => {
      attempts += 1;
      return url.includes('access_token=tok1') ? json({ errcode: 42001, errmsg: 'access_token expired' }) : image(PNG);
    });
    const view = await service.code();
    expect(view.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(attempts).toBe(2);
    expect(tokenCalls()).toBe(2);
  });

  it('explains in plain words when WeChat refuses, and does not cache the failure', async () => {
    let attempts = 0;
    const { service } = setup(configured, async () => {
      attempts += 1;
      return json({ errcode: 41030, errmsg: 'invalid page' });
    });
    expect(await service.code()).toEqual({
      image: null,
      demo: false,
      message: '会员小程序还没发布这个版本，生成不了小程序码',
    });
    await service.code();
    expect(attempts).toBe(2);
  });

  it('marks the local demo when mock login is on and the member app is not configured', async () => {
    process.env.NODE_ENV = 'development';
    const { service } = setup({ WECHAT_PHONE_MOCK: 'true' }, async () => {
      throw new Error('should not call WeChat');
    });
    expect(await service.code()).toMatchObject({ image: null, demo: true });
  });

  it('never shows a demo code in production', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = setup({ WECHAT_PHONE_MOCK: 'true' }, async () => {
      throw new Error('should not call WeChat');
    });
    expect(await service.code()).toEqual({
      image: null,
      demo: false,
      message: '会员小程序还没配置好，暂时显示不了小程序码',
    });
  });
});
