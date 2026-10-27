import { ForbiddenException } from '@nestjs/common';
import type { StaffRole } from 'shared';
import type { AccessPrincipal, RoleClaim } from './access-principal';

const ROLE_RANK: Record<StaffRole, number> = {
  STAFF: 1,
  STORE_MANAGER: 2,
  SUPER_ADMIN: 3,
};

export function isSuperAdmin(roles: readonly RoleClaim[]): boolean {
  return roles.some((role) => role.role === 'SUPER_ADMIN');
}

/** 店长能管理的门店。超级管理员不走这份名单，调用方要先判断。 */
export function managedStoreIds(roles: readonly RoleClaim[]): string[] {
  return [
    ...new Set(roles.filter((role) => role.role === 'STORE_MANAGER').map((role) => role.storeId)),
  ];
}

/**
 * 高级角色包含低级角色能做的事：超级管理员 > 店长 > 店员。
 * 这里只看角色，不看门店。跨店要另外判断。
 */
export function authorizeRoles(
  principal: AccessPrincipal,
  required: readonly StaffRole[] | undefined,
): void {
  if (!required || required.length === 0) {
    return;
  }
  if (principal.principalType !== 'STAFF') {
    throw new ForbiddenException('无权执行该操作');
  }
  const held = principal.roles.reduce((max, role) => Math.max(max, ROLE_RANK[role.role]), 0);
  const allowed = required.some((role) => held >= ROLE_RANK[role]);
  if (!allowed) {
    throw new ForbiddenException('无权执行该操作');
  }
}

/** 能否查看这家门店。超级管理员不受门店限制。 */
export function assertStoreAccess(roles: readonly RoleClaim[], storeId: string): void {
  if (isSuperAdmin(roles)) {
    return;
  }
  if (!roles.some((role) => role.storeId === storeId)) {
    throw new ForbiddenException('无权操作该门店');
  }
}

/** 能否管理这家门店（改资料、管本店员工）。店员不行。 */
export function assertCanManageStore(roles: readonly RoleClaim[], storeId: string): void {
  if (isSuperAdmin(roles)) {
    return;
  }
  if (!roles.some((role) => role.storeId === storeId && role.role === 'STORE_MANAGER')) {
    throw new ForbiddenException('无权操作该门店');
  }
}
