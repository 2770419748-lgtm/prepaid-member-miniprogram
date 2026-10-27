import { describe, expect, it } from 'vitest';
import { buildMenu } from '../menu';
import { canEditStaff, canManageStore, canReverse, hasRoleAtLeast, highestRole, type RoleClaim } from '../utils/roles';

const admin: RoleClaim[] = [{ storeId: 's1', role: 'SUPER_ADMIN' }];
const manager: RoleClaim[] = [
  { storeId: 's1', role: 'STORE_MANAGER' },
  { storeId: 's2', role: 'STAFF' },
];
const clerk: RoleClaim[] = [{ storeId: 's2', role: 'STAFF' }];

describe('角色', () => {
  it('取最高角色', () => {
    expect(highestRole(manager)).toBe('STORE_MANAGER');
    expect(highestRole([])).toBeNull();
    expect(hasRoleAtLeast(manager, 'STAFF')).toBe(true);
    expect(hasRoleAtLeast(clerk, 'STORE_MANAGER')).toBe(false);
    expect(hasRoleAtLeast(admin, 'STORE_MANAGER')).toBe(true);
  });

  it('店长只能管自己当店长的门店', () => {
    expect(canManageStore(manager, 's1')).toBe(true);
    expect(canManageStore(manager, 's2')).toBe(false);
    expect(canManageStore(admin, 'any')).toBe(true);
    expect(canManageStore(clerk, 's2')).toBe(false);
  });
});

describe('冲正按钮', () => {
  const entry = { type: 'RECHARGE', storeId: 's1', reversedById: null };

  it('超级管理员和原门店店长可以冲', () => {
    expect(canReverse(admin, entry)).toBe(true);
    expect(canReverse(manager, entry)).toBe(true);
  });

  it('店员、别店店长不能冲', () => {
    expect(canReverse(clerk, entry)).toBe(false);
    expect(canReverse(manager, { ...entry, storeId: 's2' })).toBe(false);
  });

  it('冲正流水和已冲正的不能再冲', () => {
    expect(canReverse(admin, { ...entry, type: 'REVERSAL' })).toBe(false);
    expect(canReverse(admin, { ...entry, reversedById: 'x' })).toBe(false);
  });
});

describe('员工编辑权限', () => {
  it('店长只能改本店普通店员，不能改自己和店长', () => {
    expect(canEditStaff(manager, 'me', { id: 'a', roles: [{ storeId: 's1', role: 'STAFF' }] })).toBe(true);
    expect(canEditStaff(manager, 'me', { id: 'me', roles: [{ storeId: 's1', role: 'STORE_MANAGER' }] })).toBe(false);
    expect(canEditStaff(manager, 'me', { id: 'b', roles: [{ storeId: 's1', role: 'STORE_MANAGER' }] })).toBe(false);
    expect(canEditStaff(manager, 'me', { id: 'c', roles: [{ storeId: 's3', role: 'STAFF' }] })).toBe(false);
  });

  it('超级管理员都能改', () => {
    expect(canEditStaff(admin, 'me', { id: 'b', roles: [{ storeId: 's1', role: 'STORE_MANAGER' }] })).toBe(true);
  });
});

describe('菜单按角色隐藏', () => {
  const keys = (roles: RoleClaim[]) =>
    buildMenu((role) => hasRoleAtLeast(roles, role), roles.some((r) => r.role === 'SUPER_ADMIN')).flatMap((g) =>
      g.children ? g.children.map((c) => c.key) : [g.key],
    );

  it('店员看不到员工管理', () => {
    expect(keys(clerk)).not.toContain('staff');
    expect(keys(clerk)).toContain('recharge');
    expect(keys(clerk)).toContain('ledger');
  });

  it('店长和超级管理员能看到员工管理', () => {
    expect(keys(manager)).toContain('staff');
    expect(keys(admin)).toContain('staff');
  });
});

describe('权益单菜单', () => {
  it('模板配置只给超级管理员，发起签署人人都有', () => {
    const keysFor = (roles: RoleClaim[]) =>
      buildMenu((role) => hasRoleAtLeast(roles, role), roles.some((r) => r.role === 'SUPER_ADMIN')).flatMap((g) =>
        g.children ? g.children.map((c) => c.key) : [g.key],
      );
    expect(keysFor(clerk)).toContain('sign-flows');
    expect(keysFor(clerk)).not.toContain('benefit-templates');
    expect(keysFor(manager)).not.toContain('benefit-templates');
    expect(keysFor(admin)).toContain('benefit-templates');
  });
});
