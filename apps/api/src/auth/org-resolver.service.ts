import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrgResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** 指定组织，或在只有一家在营公司时自动用那一家。 */
  async resolve(orgId?: string): Promise<string> {
    if (orgId) {
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!org || org.status !== 'ACTIVE') {
        throw new NotFoundException('组织不存在或已停用');
      }
      return org.id;
    }
    const orgs = await this.prisma.org.findMany({
      where: { status: 'ACTIVE' },
      take: 2,
      select: { id: true },
    });
    if (orgs.length === 1) {
      return orgs[0].id;
    }
    throw new BadRequestException('请指定组织');
  }
}
