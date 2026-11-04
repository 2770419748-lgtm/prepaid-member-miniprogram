import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrgResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 指定组织，或在只有一家在营公司时自动用那一家。
   * 微信审核用的演示公司不算：正常登录（小程序手机号、网页密码）永远进不了演示公司，只有审核体验入口能进。
   */
  async resolve(orgId?: string): Promise<string> {
    if (orgId) {
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!org || org.status !== 'ACTIVE' || org.demoOfId) {
        throw new NotFoundException('组织不存在或已停用');
      }
      return org.id;
    }
    const orgs = await this.prisma.org.findMany({
      where: { status: 'ACTIVE', demoOfId: null },
      take: 2,
      select: { id: true },
    });
    if (orgs.length === 1) {
      return orgs[0].id;
    }
    throw new BadRequestException('请指定组织');
  }
}
