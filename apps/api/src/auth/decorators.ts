import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { StaffRole } from 'shared';
import type { AccessPrincipal, PrincipalType } from './access-principal';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 还没改掉初始密码时也能调的接口。只给「修改密码」「查看本人信息」用，其他接口默认都拦。
 * 加新接口不用管它；放宽前先想清楚。test/password-change-guard.spec.ts 会核对名单。
 */
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

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
