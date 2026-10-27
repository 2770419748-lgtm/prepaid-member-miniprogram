import { UnauthorizedException } from '@nestjs/common';
import type { StaffRole } from 'shared';

export type PrincipalType = 'MEMBER' | 'STAFF';

export interface RoleClaim {
  storeId: string;
  role: StaffRole;
}

export interface AccessPrincipal {
  sub: string;
  orgId: string;
  principalType: PrincipalType;
  roles: RoleClaim[];
}

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'SUPER_ADMIN' || value === 'STORE_MANAGER' || value === 'STAFF';
}

function readRoles(value: unknown): RoleClaim[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new UnauthorizedException('未登录');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new UnauthorizedException('未登录');
    }
    const record = item as { storeId?: unknown; role?: unknown };
    if (typeof record.storeId !== 'string' || record.storeId.length === 0 || !isStaffRole(record.role)) {
      throw new UnauthorizedException('未登录');
    }
    return { storeId: record.storeId, role: record.role };
  });
}

/** 校验登录凭证里的身份。会员凭证不能夹带门店角色。 */
export function parsePrincipal(payload: unknown): AccessPrincipal {
  if (!payload || typeof payload !== 'object') {
    throw new UnauthorizedException('未登录');
  }
  const body = payload as { sub?: unknown; orgId?: unknown; principalType?: unknown; roles?: unknown };
  if (typeof body.sub !== 'string' || body.sub.length === 0) {
    throw new UnauthorizedException('未登录');
  }
  if (typeof body.orgId !== 'string' || body.orgId.length === 0) {
    throw new UnauthorizedException('未登录');
  }
  if (body.principalType !== 'MEMBER' && body.principalType !== 'STAFF') {
    throw new UnauthorizedException('未登录');
  }
  const roles = readRoles(body.roles);
  if (body.principalType === 'MEMBER' && roles.length > 0) {
    throw new UnauthorizedException('未登录');
  }
  return {
    sub: body.sub,
    orgId: body.orgId,
    principalType: body.principalType,
    roles,
  };
}
