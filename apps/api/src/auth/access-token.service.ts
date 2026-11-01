import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessPrincipal } from './access-principal';
import { MINIPROGRAM_DEFAULT_EXPIRES_SECONDS, parseExpiresSeconds } from './expires';

export interface IssuedToken {
  accessToken: string;
  /** 秒。 */
  expiresIn: number;
}

/**
 * 签发登录凭证。有效期分两种：
 * - 小程序（会员小程序、员工小程序，都是微信手机号登录）：`MINIPROGRAM_JWT_EXPIRES_IN`，默认 30 天，
 *   可以续期（`POST /auth/member/session/renew`、`POST /auth/staff/session/renew`）。
 * - 网页后台（员工用手机号和密码登录）：`JWT_EXPIRES_IN`，默认 12 小时，不续期。
 * 停用、改密、重置密码在每次请求时按数据库判断，凭证有效期再长也会马上失效。
 */
@Injectable()
export class AccessTokenService {
  readonly expiresInSeconds: number;
  readonly miniProgramExpiresInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.expiresInSeconds = parseExpiresSeconds(config.get<string>('JWT_EXPIRES_IN'));
    this.miniProgramExpiresInSeconds = parseExpiresSeconds(
      config.get<string>('MINIPROGRAM_JWT_EXPIRES_IN'),
      MINIPROGRAM_DEFAULT_EXPIRES_SECONDS,
    );
  }

  /** 会员一律是小程序登录；员工看登录方式，微信手机号是员工小程序，密码是网页后台。 */
  expiresInFor(principal: AccessPrincipal): number {
    const fromMiniProgram =
      principal.principalType === 'MEMBER' || principal.session?.method === 'WECHAT';
    return fromMiniProgram ? this.miniProgramExpiresInSeconds : this.expiresInSeconds;
  }

  issue(principal: AccessPrincipal): IssuedToken {
    const expiresIn = this.expiresInFor(principal);
    const accessToken = this.jwt.sign(
      {
        sub: principal.sub,
        orgId: principal.orgId,
        principalType: principal.principalType,
        roles: principal.roles,
        ...(principal.session
          ? { sessionVersion: principal.session.version, loginMethod: principal.session.method }
          : {}),
      },
      { expiresIn },
    );
    return { accessToken, expiresIn };
  }
}
