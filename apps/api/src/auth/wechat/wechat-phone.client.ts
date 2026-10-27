import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WechatPhoneResult {
  phone: string;
  countryCode: string;
  openId: string;
  unionId: string | null;
}

export interface WechatPhoneExchange {
  appId: string;
  secret: string;
  code: string;
  phoneCode: string;
}

export interface WechatFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type WechatFetch = (
  url: string,
  init?: WechatFetchInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: WechatFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
};

/**
 * 用微信测试号换 openid 和手机号。密钥只放在请求里，不写进错误信息。
 */
@Injectable()
export class WechatPhoneClient {
  private readonly logger = new Logger(WechatPhoneClient.name);
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  /** 测试可替换。正式运行使用系统网络。 */
  fetchImpl: WechatFetch = defaultFetch;

  constructor(private readonly config: ConfigService) {}

  async exchange(input: WechatPhoneExchange): Promise<WechatPhoneResult> {
    const session = await this.readJson(this.sessionUrl(input).toString());
    this.assertOk(session);
    const openId = this.readString(session, 'openid');
    if (!openId) {
      throw new UnauthorizedException('微信登录失败');
    }
    const unionRaw = this.readString(session, 'unionid');
    const accessToken = await this.accessToken(input.appId, input.secret);
    const phoneUrl = new URL('/wxa/business/getuserphonenumber', this.base());
    phoneUrl.searchParams.set('access_token', accessToken);
    const phoneBody = await this.readJson(phoneUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.phoneCode }),
    });
    this.assertOk(phoneBody);
    const info = phoneBody.phone_info;
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      throw new UnauthorizedException('微信登录失败');
    }
    const record = info as Record<string, unknown>;
    const phone = typeof record.purePhoneNumber === 'string' ? record.purePhoneNumber : '';
    const countryRaw = record.countryCode;
    const countryCode =
      typeof countryRaw === 'number'
        ? String(countryRaw)
        : typeof countryRaw === 'string' && countryRaw.trim() !== ''
          ? countryRaw
          : '86';
    return {
      phone,
      countryCode,
      openId,
      unionId: unionRaw,
    };
  }

  private sessionUrl(input: WechatPhoneExchange): URL {
    const url = new URL('/sns/jscode2session', this.base());
    url.searchParams.set('appid', input.appId);
    url.searchParams.set('secret', input.secret);
    url.searchParams.set('js_code', input.code);
    url.searchParams.set('grant_type', 'authorization_code');
    return url;
  }

  private async accessToken(appId: string, secret: string): Promise<string> {
    const cached = this.tokens.get(appId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.token;
    }
    const url = new URL('/cgi-bin/token', this.base());
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', secret);
    const body = await this.readJson(url.toString());
    this.assertOk(body);
    const token = this.readString(body, 'access_token');
    if (!token) {
      throw new UnauthorizedException('微信登录失败');
    }
    const expires = typeof body.expires_in === 'number' ? body.expires_in : 7200;
    this.tokens.set(appId, { token, expiresAt: now + Math.max(expires - 60, 30) * 1000 });
    return token;
  }

  private base(): string {
    const configured = this.config.get<string>('WECHAT_API_BASE')?.trim();
    return configured || 'https://api.weixin.qq.com';
  }

  private async readJson(url: string, init?: WechatFetchInit): Promise<Record<string, unknown>> {
    let response: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      response = await this.fetchImpl(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(8000) });
    } catch {
      this.logger.warn('wechat network failed');
      throw new BadGatewayException('微信登录失败');
    }
    if (!response.ok) {
      this.logger.warn(`wechat http ${response.status}`);
      throw new BadGatewayException('微信登录失败');
    }
    try {
      const body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('bad json');
      }
      return body as Record<string, unknown>;
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadGatewayException) {
        throw error;
      }
      this.logger.warn('wechat response unreadable');
      throw new BadGatewayException('微信登录失败');
    }
  }

  private assertOk(body: Record<string, unknown>): void {
    if (typeof body.errcode === 'number' && body.errcode !== 0) {
      this.logger.warn(`wechat errcode=${body.errcode}`);
      throw new UnauthorizedException('微信登录失败');
    }
  }

  private readString(body: Record<string, unknown>, key: string): string | null {
    const value = body[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
