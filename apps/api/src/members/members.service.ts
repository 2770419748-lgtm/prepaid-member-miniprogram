import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessPrincipal } from '../auth/access-principal';
import { PrismaService } from '../prisma/prisma.service';
import { toMemberView } from './member.view';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(principal: AccessPrincipal) {
    const member = await this.prisma.member.findUnique({ where: { id: principal.sub } });
    if (!member || member.orgId !== principal.orgId || principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    return toMemberView(member);
  }
}
