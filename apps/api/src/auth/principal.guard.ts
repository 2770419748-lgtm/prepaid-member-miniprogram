import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessPrincipal, PrincipalType } from './access-principal';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, PRINCIPALS_KEY } from './decorators';
import { PrismaService } from '../prisma/prisma.service';

/** 还没改初始密码时调了别的接口。网页后台据此跳到改密页。 */
export const MUST_CHANGE_PASSWORD = 'MUST_CHANGE_PASSWORD';

interface AuthenticatedRequest {
  user?: AccessPrincipal;
}

/**
 * 以数据库里的当前状态为准，不轻信凭证里旧的角色。停用后立即失效。
 * 员工凭证的登录版本号对不上（改过或被重置过密码）也失效。
 */
export async function refreshPrincipal(
  prisma: PrismaService,
  current: AccessPrincipal,
): Promise<AccessPrincipal> {
  if (current.principalType === 'STAFF') {
    const staff = await prisma.staff.findUnique({
      where: { id: current.sub },
      include: { storeRoles: true, org: { select: { status: true } } },
    });
    if (
      !staff ||
      staff.orgId !== current.orgId ||
      staff.status !== 'ACTIVE' ||
      staff.org.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('登录已失效');
    }
    // 改过密码或被重置过密码，之前签发的凭证都作废。
    if (!current.session || current.session.version !== staff.sessionVersion) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return {
      sub: staff.id,
      orgId: staff.orgId,
      principalType: 'STAFF',
      roles: staff.storeRoles.map((role) => ({ storeId: role.storeId, role: role.role })),
      session: current.session,
      passwordChangeRequired: current.session.method === 'PASSWORD' && staff.mustChangePassword,
    };
  }

  const member = await prisma.member.findUnique({
    where: { id: current.sub },
    include: { org: { select: { status: true } } },
  });
  if (
    !member ||
    member.orgId !== current.orgId ||
    member.status !== 'ACTIVE' ||
    member.org.status !== 'ACTIVE'
  ) {
    throw new UnauthorizedException('登录已失效');
  }
  return {
    sub: member.id,
    orgId: member.orgId,
    principalType: 'MEMBER',
    roles: [],
  };
}

/**
 * 用初始密码登录网页后台、还没改密的员工，只能调标了 @AllowPendingPassword() 的接口（改密码、看本人信息）。
 * 这里是全局守卫的一步，新接口默认被拦，不用逐个接口判断。员工小程序用微信手机号登录，不受影响；会员也不受影响。
 */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException('未登录');
    }
    request.user = await refreshPrincipal(this.prisma, request.user);
    if (request.user.passwordChangeRequired) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({ code: MUST_CHANGE_PASSWORD, message: '请先修改初始密码' });
      }
    }
    const required = this.reflector.getAllAndOverride<PrincipalType[]>(PRINCIPALS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0 && !required.includes(request.user.principalType)) {
      throw new ForbiddenException('无权访问');
    }
    return true;
  }
}
