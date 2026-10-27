import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { StaffRole } from 'shared';
import type { AccessPrincipal, PrincipalType } from './access-principal';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export const PRINCIPALS_KEY = 'principals';
export const Principals = (...types: PrincipalType[]) => SetMetadata(PRINCIPALS_KEY, types);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPrincipal => {
    const request = ctx.switchToHttp().getRequest<{ user?: AccessPrincipal }>();
    if (!request.user) {
      throw new UnauthorizedException('未登录');
    }
    return request.user;
  },
);
