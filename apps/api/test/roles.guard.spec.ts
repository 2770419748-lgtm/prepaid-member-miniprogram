import 'reflect-metadata';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from 'shared';
import { AccessPrincipal, PrincipalType, RoleClaim } from '../src/auth/access-principal';
import { Roles } from '../src/auth/decorators';
import { RolesGuard } from '../src/auth/roles.guard';

function contextFor(principal: AccessPrincipal, required?: StaffRole[]): ExecutionContext {
  class Marker {}
  if (required) {
    Roles(...required)(Marker);
  }
  return {
    getClass: () => Marker,
    getHandler: () => function handler() {
      return undefined;
    },
    switchToHttp: () => ({
      getRequest: () => ({ user: principal }),
    }),
  } as unknown as ExecutionContext;
}

function principal(type: PrincipalType, roleClaims: RoleClaim[]): AccessPrincipal {
  return { sub: 'user-1', orgId: 'org-1', principalType: type, roles: roleClaims };
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  const cases: Array<[string, PrincipalType, RoleClaim[], StaffRole[] | undefined, boolean]> = [
    ['staff cannot call a super-admin action', 'STAFF', [{ storeId: 'a', role: 'STAFF' }], ['SUPER_ADMIN'], false],
    [
      'manager cannot call a super-admin action',
      'STAFF',
      [{ storeId: 'a', role: 'STORE_MANAGER' }],
      ['SUPER_ADMIN'],
      false,
    ],
    ['super admin can call a super-admin action', 'STAFF', [{ storeId: 'a', role: 'SUPER_ADMIN' }], ['SUPER_ADMIN'], true],
    [
      'super admin can call a manager action',
      'STAFF',
      [{ storeId: 'a', role: 'SUPER_ADMIN' }],
      ['STORE_MANAGER'],
      true,
    ],
    [
      'manager can call a manager action',
      'STAFF',
      [{ storeId: 'a', role: 'STORE_MANAGER' }],
      ['SUPER_ADMIN', 'STORE_MANAGER'],
      true,
    ],
    ['staff cannot call a manager action', 'STAFF', [{ storeId: 'a', role: 'STAFF' }], ['STORE_MANAGER'], false],
    ['staff with no role is denied', 'STAFF', [], ['STAFF'], false],
    ['member cannot call a staff action', 'MEMBER', [], ['STAFF'], false],
    ['a route without a role requirement allows a member', 'MEMBER', [], undefined, true],
    ['clerk can call a staff-level action', 'STAFF', [{ storeId: 'a', role: 'STAFF' }], ['STAFF'], true],
  ];

  it.each(cases)('%s', (_name, type, roleClaims, required, allowed) => {
    const run = () => guard.canActivate(contextFor(principal(type, roleClaims), required));
    if (allowed) {
      expect(run()).toBe(true);
    } else {
      expect(run).toThrow(ForbiddenException);
      expect(run).toThrow('无权执行该操作');
    }
  });
});
