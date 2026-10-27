import type { StaffRole } from 'shared';
import { assertCanManageStore, assertStoreAccess } from '../src/auth/staff-access';
import type { RoleClaim } from '../src/auth/access-principal';

function roles(storeId: string, role: StaffRole): RoleClaim[] {
  return [{ storeId, role }];
}

describe('store scope', () => {
  it.each([
    ['manager of another store', roles('store-a', 'STORE_MANAGER'), 'store-b', false],
    ['manager of this store', roles('store-a', 'STORE_MANAGER'), 'store-a', true],
    ['clerk of another store', roles('store-a', 'STAFF'), 'store-b', false],
    ['clerk of this store', roles('store-a', 'STAFF'), 'store-a', true],
    ['super admin of any store', roles('store-a', 'SUPER_ADMIN'), 'store-b', true],
  ])('%s', (_name, claims, storeId, allowed) => {
    if (allowed) {
      expect(() => assertStoreAccess(claims, storeId)).not.toThrow();
    } else {
      expect(() => assertStoreAccess(claims, storeId)).toThrow('无权操作该门店');
    }
  });

  it('lets only a manager or super admin change a store', () => {
    expect(() => assertCanManageStore(roles('store-a', 'STAFF'), 'store-a')).toThrow('无权操作该门店');
    expect(() => assertCanManageStore(roles('store-a', 'STORE_MANAGER'), 'store-b')).toThrow(
      '无权操作该门店',
    );
    expect(() => assertCanManageStore(roles('store-a', 'STORE_MANAGER'), 'store-a')).not.toThrow();
    expect(() => assertCanManageStore(roles('store-a', 'SUPER_ADMIN'), 'store-b')).not.toThrow();
  });
});
