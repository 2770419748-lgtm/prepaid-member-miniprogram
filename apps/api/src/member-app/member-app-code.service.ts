import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatAppConfig } from '../auth/wechat/wechat-app.config';
import { WechatPhoneClient } from '../auth/wechat/wechat-phone.client';

/** 员工小程序开单完成后弹给顾客扫的会员小程序码。 */
export interface MemberAppCodeView {
  /** 小程序码图片（data URL）。拿不到时为空。 */
  image: string | null;
  /** 本机演示（假手机号登录开着）拿不到真码：页面画一张标明「演示」的码，扫了没用。 */
  demo: boolean;
  /** 拿不到小程序码时给店员看的原因。 */
  message: string | null;
}

export interface AppCodeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AppCodeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<AppCodeResponse>;

/** 顾客扫码后打开的页面：会员小程序首页，没登录会先到登录页。 */
const MEMBER_HOME = 'pages/index/index';

/** 小程序码不会变，取到一次存半天，免得每开一单都去微信要一次。 */
const CACHE_MS = 12 * 60 * 60 * 1000;

/** 微信说接口调用凭证无效或过期。 */
const TOKEN_ERRCODES = new Set([40001, 40014, 42001]);

/**
 * 用会员小程序的 AppID 向微信要小程序码（getwxacodeunlimit）。
 * 只在服务端调用，密钥不出服务器；拿不到时返回原因，不抛错，开单页照样能完成。
 */
@Injectable()
export class MemberAppCodeService {
  private readonly logger = new Logger(MemberAppCodeService.name);
  private cached: { key: string; image: string; expiresAt: number } | null = null;

  /** 测试可替换。正式运行使用系统网络。 */
  fetchImpl: AppCodeFetch = (url, init) => fetch(url, init);

  constructor(
    private readonly config: ConfigService,
    private readonly app: WechatAppConfig,
    private readonly wechat: WechatPhoneClient,
  ) {}

  async code(): Promise<MemberAppCodeView> {
    let credentials: { appId: string; secret: string };
    try {
      credentials = this.app.credentials('member');
    } catch {
      return this.app.mockEnabled
        ? { image: null, demo: true, message: '本机演示环境没有配置会员小程序，这是演示码，扫了打不开' }
        : { image: null, demo: false, message: '会员小程序还没配置好，暂时显示不了小程序码' };
    }
    const envVersion = this.envVersion();
    const key = `${credentials.appId}:${envVersion}`;
    if (this.cached && this.cached.key === key && this.cached.expiresAt > Date.now()) {
      return { image: this.cached.image, demo: false, message: null };
    }
    try {
      const image = await this.fetchCode(credentials, envVersion, true);
      this.cached = { key, image, expiresAt: Date.now() + CACHE_MS };
      return { image, demo: false, message: null };
    } catch (error) {
      const message = error instanceof AppCodeError ? error.message : '暂时生成不了会员小程序码，请稍后再试';
      return { image: null, demo: this.app.mockEnabled, message };
    }
  }

  /** release 正式版；会员小程序还没发布时可以配成 trial（体验版）或 develop（开发版）。 */
  private envVersion(): 'release' | 'trial' | 'develop' {
    const value = (this.config.get<string>('WECHAT_MEMBER_CODE_ENV') ?? '').trim();
    return value === 'trial' || value === 'develop' ? value : 'release';
  }

  private async fetchCode(
    credentials: { appId: string; secret: string },
    envVersion: string,
    retryOnToken: boolean,
  ): Promise<string> {
    const token = await this.wechat.accessToken(credentials.appId, credentials.secret);
    const url = new URL('/wxa/getwxacodeunlimit', this.wechat.base());
    url.searchParams.set('access_token', token);
    let response: AppCodeResponse;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scene: 'from=staff',
          page: MEMBER_HOME,
          check_path: false,
          env_version: envVersion,
          width: 430,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      this.logger.warn('wechat app code network failed');
      throw new AppCodeError('连不上微信，暂时生成不了会员小程序码');
    }
    const type = response.headers.get('content-type') ?? '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      this.logger.warn(`wechat app code http ${response.status}`);
      throw new AppCodeError('暂时生成不了会员小程序码，请稍后再试');
    }
    // 出错时微信回一段 JSON（errcode），成功时直接是图片。
    if (type.includes('json') || bytes.subarray(0, 1).toString('latin1') === '{') {
      const errcode = readErrcode(bytes);
      this.logger.warn(`wechat app code errcode=${errcode ?? 'unknown'}`);
      if (errcode !== null && TOKEN_ERRCODES.has(errcode) && retryOnToken) {
        this.wechat.forgetAccessToken(credentials.appId);
        return this.fetchCode(credentials, envVersion, false);
      }
      throw new AppCodeError(
        errcode === 41030
          ? '会员小程序还没发布这个版本，生成不了小程序码'
          : '暂时生成不了会员小程序码，请稍后再试',
      );
    }
    const mime = type.startsWith('image/') ? type.split(';')[0] : 'image/jpeg';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
}

/** 能直接给店员看的原因。 */
class AppCodeError extends Error {}

function readErrcode(bytes: Buffer): number | null {
  try {
    const body = JSON.parse(bytes.toString('utf8')) as { errcode?: unknown };
    return typeof body.errcode === 'number' ? body.errcode : null;
  } catch {
    return null;
  }
}
