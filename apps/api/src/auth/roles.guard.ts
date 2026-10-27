import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from 'shared';
import { AccessPrincipal } from './access-principal';
import { IS_PUBLIC, ROLES_KEY } from './decorators';
import { authorizeRoles } from './staff-access';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AccessPrincipal }>();
    if (!request.user) {
      throw new UnauthorizedException('未登录');
    }
    authorizeRoles(request.user, required);
    return true;
  }
}
