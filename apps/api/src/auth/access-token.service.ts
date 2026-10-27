import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessPrincipal } from './access-principal';
import { parseExpiresSeconds } from './expires';

@Injectable()
export class AccessTokenService {
  readonly expiresInSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.expiresInSeconds = parseExpiresSeconds(config.get<string>('JWT_EXPIRES_IN'));
  }

  sign(principal: AccessPrincipal): string {
    return this.jwt.sign(
      {
        sub: principal.sub,
        orgId: principal.orgId,
        principalType: principal.principalType,
        roles: principal.roles,
      },
      { expiresIn: this.expiresInSeconds },
    );
  }
}
