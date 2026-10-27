import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccessPrincipal } from '../auth/access-principal';
import { PrismaService } from '../prisma/prisma.service';
import { MemberStoreView, toMemberStoreView } from '../org/store.view';
import { MemberWalletView, toMemberView } from './member.view';

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

  /** 会员自己的总余额。还没开卡时余额为 0、hasCard 为 false。 */
  async wallet(principal: AccessPrincipal): Promise<MemberWalletView> {
    if (principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { memberId: principal.sub } });
    if (!wallet) {
      return { hasCard: false, balanceCent: 0, openedAt: null, updatedAt: null };
    }
    return {
      hasCard: true,
      balanceCent: wallet.balanceCent,
      openedAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  async usableStores(principal: AccessPrincipal): Promise<MemberStoreView[]> {
    if (principal.principalType !== 'MEMBER') {
      throw new UnauthorizedException('登录已失效');
    }
    const stores = await this.prisma.store.findMany({
      where: { orgId: principal.orgId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return stores.map(toMemberStoreView);
  }
}
