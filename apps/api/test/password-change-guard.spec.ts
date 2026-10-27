import 'reflect-metadata';

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readdirSync } from 'fs';
import { join } from 'path';
import type { AccessPrincipal, LoginMethod } from '../src/auth/access-principal';
import { ALLOW_PENDING_PASSWORD, AllowPendingPassword } from '../src/auth/decorators';
import { PrincipalGuard } from '../src/auth/principal.guard';
import type { PrismaService } from '../src/prisma/prisma.service';

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return controllerFiles(path);
    }
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** 所有接口里，没改初始密码也能调的那些（类名.方法名）。 */
function pendingPasswordAllowList(): string[] {
  const allowed: string[] = [];
  for (const file of controllerFiles(join(__dirname, '../src'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function' || Reflect.getMetadata(PATH_METADATA, value) === undefined) {
        continue;
      }
      const controller = value as { name: string; prototype: Record<string, unknown> };
      if (Reflect.getMetadata(ALLOW_PENDING_PASSWORD, controller)) {
        allowed.push(`${controller.name}.*`);
      }
      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[key];
        if (key !== 'constructor' && typeof handler === 'function' && Reflect.getMetadata(ALLOW_PENDING_PASSWORD, handler)) {
          allowed.push(`${controller.name}.${key}`);
        }
      }
    }
  }
  return allowed.sort();
}

interface StaffRow {
  id: string;
  orgId: string;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  sessionVersion: number;
  storeRoles: { storeId: string; role: 'STAFF' | 'STORE_MANAGER' | 'SUPER_ADMIN' }[];
  org: { status: 'ACTIVE' };
}

function fakePrisma(staff: StaffRow): PrismaService {
  return {
    staff: { findUnique: jest.fn(() => Promise.resolve(staff)) },
    member: {
      findUnique: jest.fn(() =>
        Promise.resolve({ id: 'member-1', orgId: 'org-1', status: 'ACTIVE', org: { status: 'ACTIVE' } }),
      ),
    },
  } as unknown as PrismaService;
}

class Endpoints {
  recharge(): void {}

  @AllowPendingPassword()
  changePassword(): void {}
}

function contextFor(user: AccessPrincipal, handler: keyof Endpoints): ExecutionContext {
  const request = { user };
  return {
    getClass: () => Endpoints,
    getHandler: () => Endpoints.prototype[handler],
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function staffRow(overrides: Partial<StaffRow> = {}): StaffRow {
  return {
    id: 'staff-1',
    orgId: 'org-1',
    status: 'ACTIVE',
    mustChangePassword: true,
    sessionVersion: 2,
    storeRoles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
    org: { status: 'ACTIVE' },
    ...overrides,
  };
}

function staffToken(method: LoginMethod, version = 2): AccessPrincipal {
  return {
    sub: 'staff-1',
    orgId: 'org-1',
    principalType: 'STAFF',
    roles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
    session: { version, method },
  };
}

describe('forced password change guard', () => {
  it('only lets "change password" and "who am I" through before the initial password is changed', () => {
    // 新接口默认被拦。要往这里加，先想清楚为什么没改密也必须能调。
    expect(pendingPasswordAllowList()).toEqual(['AuthController.changeStaffPassword', 'AuthController.me']);
  });

  it('rejects a password session with MUST_CHANGE_PASSWORD on any other endpoint', async () => {
    const guard = new PrincipalGuard(new Reflector(), fakePrisma(staffRow()));
    const error: unknown = await guard
      .canActivate(contextFor(staffToken('PASSWORD'), 'recharge'))
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'MUST_CHANGE_PASSWORD',
      message: '请先修改初始密码',
    });
    await expect(guard.canActivate(contextFor(staffToken('PASSWORD'), 'changePassword'))).resolves.toBe(true);
  });

  it('does not block mini-program sessions (WeChat phone login) or staff who already changed it', async () => {
    const pending = new PrincipalGuard(new Reflector(), fakePrisma(staffRow()));
    await expect(pending.canActivate(contextFor(staffToken('WECHAT'), 'recharge'))).resolves.toBe(true);
    const changed = new PrincipalGuard(new Reflector(), fakePrisma(staffRow({ mustChangePassword: false })));
    await expect(changed.canActivate(contextFor(staffToken('PASSWORD'), 'recharge'))).resolves.toBe(true);
  });

  it('treats a token from before the last password change or reset as logged out', async () => {
    const guard = new PrincipalGuard(new Reflector(), fakePrisma(staffRow({ sessionVersion: 3 })));
    await expect(guard.canActivate(contextFor(staffToken('WECHAT', 2), 'recharge'))).rejects.toThrow(
      UnauthorizedException,
    );
    const legacy: AccessPrincipal = { ...staffToken('WECHAT'), session: undefined };
    await expect(guard.canActivate(contextFor(legacy, 'recharge'))).rejects.toThrow(UnauthorizedException);
  });

  it('leaves members alone', async () => {
    const guard = new PrincipalGuard(new Reflector(), fakePrisma(staffRow()));
    const member: AccessPrincipal = { sub: 'member-1', orgId: 'org-1', principalType: 'MEMBER', roles: [] };
    await expect(guard.canActivate(contextFor(member, 'recharge'))).resolves.toBe(true);
  });
});
