import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isObservable, lastValueFrom, Observable } from 'rxjs';
import { IS_PUBLIC } from './decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrincipalGuard } from './principal.guard';
import { RolesGuard } from './roles.guard';

async function settle(result: boolean | Promise<boolean> | Observable<boolean>): Promise<boolean> {
  if (isObservable(result)) {
    return lastValueFrom(result);
  }
  return result;
}

/**
 * 固定顺序：先确认登录，再按数据库刷新身份，最后看角色。
 * 分开注册全局守卫时顺序不稳定，所以收成一道。
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtAuth: JwtAuthGuard,
    private readonly principal: PrincipalGuard,
    private readonly roles: RolesGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const authenticated = await settle(
      this.jwtAuth.canActivate(context) as boolean | Promise<boolean> | Observable<boolean>,
    );
    if (!authenticated) {
      return false;
    }
    const principalOk = await this.principal.canActivate(context);
    if (!principalOk) {
      return false;
    }
    return this.roles.canActivate(context);
  }
}
