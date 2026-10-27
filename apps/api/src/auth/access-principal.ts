import { UnauthorizedException } from '@nestjs/common';
import type { StaffRole } from 'shared';

export type PrincipalType = 'MEMBER' | 'STAFF';

export interface RoleClaim {
  storeId: string;
  role: StaffRole;
}

/** 员工怎么登录的：网页后台用手机号和密码，员工小程序用微信手机号。 */
export type LoginMethod = 'PASSWORD' | 'WECHAT';

export interface StaffSession {
  /** 签发时员工的登录版本号。改密码、重置密码后加一，之前签发的凭证全部作废。 */
  version: number;
  /** 只有用密码登录的才要先改掉初始密码；微信手机号登录没用到初始密码。 */
  method: LoginMethod;
}

export interface AccessPrincipal {
  sub: string;
  orgId: string;
  principalType: PrincipalType;
  roles: RoleClaim[];
  /** 员工凭证才有。 */
  session?: StaffSession;
  /**
   * 用初始密码（或被重置的密码）登录网页后台、还没改密。不在凭证里，每次请求按数据库算。
   * 为 true 时除改密码、看本人信息外的接口一律拒绝，见 PrincipalGuard。
   */
  passwordChangeRequired?: boolean;
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

/** 员工凭证必须带登录版本号和登录方式。缺了是升级前签发的旧凭证，要重新登录。 */
function readStaffSession(version: unknown, method: unknown): StaffSession {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new UnauthorizedException('登录已失效');
  }
  if (method !== 'PASSWORD' && method !== 'WECHAT') {
    throw new UnauthorizedException('登录已失效');
  }
  return { version, method };
}

/** 校验登录凭证里的身份。会员凭证不能夹带门店角色。 */
export function parsePrincipal(payload: unknown): AccessPrincipal {
  if (!payload || typeof payload !== 'object') {
    throw new UnauthorizedException('未登录');
  }
  const body = payload as {
    sub?: unknown;
    orgId?: unknown;
    principalType?: unknown;
    roles?: unknown;
    sessionVersion?: unknown;
    loginMethod?: unknown;
  };
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
  if (body.principalType === 'MEMBER') {
    if (roles.length > 0) {
      throw new UnauthorizedException('未登录');
    }
    return { sub: body.sub, orgId: body.orgId, principalType: 'MEMBER', roles };
  }
  return {
    sub: body.sub,
    orgId: body.orgId,
    principalType: 'STAFF',
    roles,
    session: readStaffSession(body.sessionVersion, body.loginMethod),
  };
}
