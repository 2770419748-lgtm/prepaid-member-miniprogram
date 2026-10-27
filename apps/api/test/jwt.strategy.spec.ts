import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../src/auth/jwt.strategy';

function strategy(): JwtStrategy {
  const config = {
    get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined),
  } as unknown as ConfigService;
  return new JwtStrategy(config);
}

describe('JwtStrategy', () => {
  it('reads a staff principal', () => {
    expect(
      strategy().validate({
        sub: 'staff-1',
        orgId: 'org-1',
        principalType: 'STAFF',
        roles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
      }),
    ).toEqual({
      sub: 'staff-1',
      orgId: 'org-1',
      principalType: 'STAFF',
      roles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
    });
  });

  it('reads a member principal without roles', () => {
    expect(
      strategy().validate({
        sub: 'member-1',
        orgId: 'org-1',
        principalType: 'MEMBER',
      }),
    ).toEqual({
      sub: 'member-1',
      orgId: 'org-1',
      principalType: 'MEMBER',
      roles: [],
    });
  });

  it('rejects a member token that smuggles store roles', () => {
    expect(() =>
      strategy().validate({
        sub: 'member-1',
        orgId: 'org-1',
        principalType: 'MEMBER',
        roles: [{ storeId: 'store-1', role: 'SUPER_ADMIN' }],
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an unknown principal type', () => {
    expect(() =>
      strategy().validate({ sub: 'x', orgId: 'org-1', principalType: 'GUEST' }),
    ).toThrow('未登录');
  });
});
