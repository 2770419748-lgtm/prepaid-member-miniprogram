import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgResolver } from '../src/auth/org-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';

interface FakeOrg {
  id: string;
  status: 'ACTIVE' | 'DISABLED';
  demoOfId: string | null;
}

/** 只认 findUnique / findMany 两个调用，按 where 过滤。 */
function resolverWith(orgs: FakeOrg[]): OrgResolver {
  const prisma = {
    org: {
      findUnique: async ({ where }: { where: { id: string } }) => orgs.find((org) => org.id === where.id) ?? null,
      findMany: async ({ where, take }: { where: { status: string; demoOfId?: null }; take: number }) =>
        orgs
          .filter((org) => org.status === where.status && (!('demoOfId' in where) || org.demoOfId === where.demoOfId))
          .slice(0, take)
          .map((org) => ({ id: org.id })),
    },
  } as unknown as PrismaService;
  return new OrgResolver(prisma);
}

describe('OrgResolver with a review demo company', () => {
  const real: FakeOrg = { id: 'real', status: 'ACTIVE', demoOfId: null };
  const demo: FakeOrg = { id: 'demo', status: 'ACTIVE', demoOfId: 'real' };

  it('still picks the only real company when a demo company exists', async () => {
    await expect(resolverWith([real, demo]).resolve()).resolves.toBe('real');
  });

  it('never resolves the demo company, even when asked for it by id', async () => {
    await expect(resolverWith([real, demo]).resolve('demo')).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolverWith([real, demo]).resolve('real')).resolves.toBe('real');
  });

  it('asks for a company when there is no real one', async () => {
    await expect(resolverWith([demo]).resolve()).rejects.toBeInstanceOf(BadRequestException);
  });
});
