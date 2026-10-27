import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessPrincipal, PrincipalType } from './access-principal';
import { IS_PUBLIC, PRINCIPALS_KEY } from './decorators';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedRequest {
  user?: AccessPrincipal;
}

/** 以数据库里的当前状态为准，不轻信凭证里旧的角色。停用后立即失效。 */
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
    return {
      sub: staff.id,
      orgId: staff.orgId,
      principalType: 'STAFF',
      roles: staff.storeRoles.map((role) => ({ storeId: role.storeId, role: role.role })),
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
