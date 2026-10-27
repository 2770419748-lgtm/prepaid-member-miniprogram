import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AccessGuard } from './access.guard';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { parseExpiresSeconds } from './expires';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { OrgResolver } from './org-resolver.service';
import { PrincipalGuard } from './principal.guard';
import { RolesGuard } from './roles.guard';
import { WechatAppConfig } from './wechat/wechat-app.config';
import { WechatIdentityService } from './wechat/wechat-identity.service';
import { WechatPhoneClient } from './wechat/wechat-phone.client';

/**
 * 账号与鉴权。
 * 小程序用微信手机号登录。网页后台员工用手机号和密码，不使用短信验证码。
 * 假手机号开关默认关闭，正式环境即使打开也不生效。
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')?.trim();
        if (!secret) {
          throw new Error('JWT_SECRET is required');
        }
        return {
          secret,
          signOptions: { expiresIn: parseExpiresSeconds(config.get<string>('JWT_EXPIRES_IN')) },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    OrgResolver,
    WechatAppConfig,
    WechatPhoneClient,
    WechatIdentityService,
    JwtStrategy,
    JwtAuthGuard,
    PrincipalGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [WechatAppConfig],
})
export class AuthModule {}
