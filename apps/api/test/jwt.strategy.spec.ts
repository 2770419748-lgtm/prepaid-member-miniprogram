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
  it('reads a staff principal with its login version and login method', () => {
    expect(
      strategy().validate({
        sub: 'staff-1',
        orgId: 'org-1',
        principalType: 'STAFF',
        roles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
        sessionVersion: 3,
        loginMethod: 'PASSWORD',
      }),
    ).toEqual({
      sub: 'staff-1',
      orgId: 'org-1',
      principalType: 'STAFF',
      roles: [{ storeId: 'store-1', role: 'STORE_MANAGER' }],
      session: { version: 3, method: 'PASSWORD' },
    });
  });

  it('rejects a staff token without a login version or login method (issued before they existed)', () => {
    const base = { sub: 'staff-1', orgId: 'org-1', principalType: 'STAFF', roles: [] };
    expect(() => strategy().validate(base)).toThrow('登录已失效');
    expect(() => strategy().validate({ ...base, sessionVersion: 0 })).toThrow('登录已失效');
    expect(() => strategy().validate({ ...base, sessionVersion: -1, loginMethod: 'WECHAT' })).toThrow('登录已失效');
    expect(() => strategy().validate({ ...base, sessionVersion: 0, loginMethod: 'SMS' })).toThrow('登录已失效');
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
