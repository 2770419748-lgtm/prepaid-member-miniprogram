import type { StaffRole } from '../api/types';

export const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: '超级管理员',
  STORE_MANAGER: '店长',
  STAFF: '店员',
};

const ROLE_RANK: Record<StaffRole, number> = {
  STAFF: 1,
  STORE_MANAGER: 2,
  SUPER_ADMIN: 3,
};

export interface RoleClaim {
  storeId: string;
  role: StaffRole;
}

/** 账号在所有门店里最高的角色。没有角色时为空。 */
export function highestRole(roles: readonly RoleClaim[]): StaffRole | null {
  let best: StaffRole | null = null;
  for (const claim of roles) {
    if (!best || ROLE_RANK[claim.role] > ROLE_RANK[best]) {
      best = claim.role;
    }
  }
  return best;
}

/** 高级角色包含低级角色能做的事：超级管理员 > 店长 > 店员。和后端一致。 */
export function hasRoleAtLeast(roles: readonly RoleClaim[], required: StaffRole): boolean {
  const held = highestRole(roles);
  return held !== null && ROLE_RANK[held] >= ROLE_RANK[required];
}

export function isSuperAdmin(roles: readonly RoleClaim[]): boolean {
  return roles.some((claim) => claim.role === 'SUPER_ADMIN');
}

export function managedStoreIds(roles: readonly RoleClaim[]): string[] {
  return [...new Set(roles.filter((claim) => claim.role === 'STORE_MANAGER').map((claim) => claim.storeId))];
}

/** 能否维护这家门店（改资料、管本店店员）。 */
export function canManageStore(roles: readonly RoleClaim[], storeId: string): boolean {
  return isSuperAdmin(roles) || managedStoreIds(roles).includes(storeId);
}

/** 冲正：超级管理员，或流水所在门店的店长。冲正流水本身和已冲正过的不能再冲。 */
export function canReverse(
  roles: readonly RoleClaim[],
  entry: { type: string; storeId: string; reversedById: string | null },
): boolean {
  if (entry.type === 'REVERSAL' || entry.reversedById) {
    return false;
  }
  return canManageStore(roles, entry.storeId);
}

/**
 * 店长能不能改这位员工：只能改自己管的店里的普通店员，不能改自己、其他店长和超级管理员。
 * 超级管理员都能改。
 */
export function canEditStaff(
  roles: readonly RoleClaim[],
  selfId: string,
  staff: { id: string; roles: readonly RoleClaim[] },
): boolean {
  if (isSuperAdmin(roles)) {
    return true;
  }
  if (staff.id === selfId) {
    return false;
  }
  if (staff.roles.some((claim) => claim.role !== 'STAFF')) {
    return false;
  }
  const managed = managedStoreIds(roles);
  return staff.roles.some((claim) => managed.includes(claim.storeId));
}
