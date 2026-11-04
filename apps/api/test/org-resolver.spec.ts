import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgResolver } from '../src/auth/org-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';

interface FakeOrg {
  id: string;
  status: 'ACTIVE' | 'DISABLED';
  /** 微信审核用的演示公司指向真实公司。 */
  demoOfId?: string | null;
}

/** 只认 findUnique / findMany 两个调用，findMany 按 where 里的 status 和 demoOfId 过滤。 */
function resolver(orgs: FakeOrg[]): OrgResolver {
  const rows = orgs.map((org) => ({ ...org, demoOfId: org.demoOfId ?? null }));
  const prisma = {
    org: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return rows.find((org) => org.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where, take }: { where: { status: string; demoOfId?: null }; take: number }) =>
        rows
          .filter((org) => org.status === where.status && (!('demoOfId' in where) || org.demoOfId === where.demoOfId))
          .slice(0, take)
          .map((org) => ({ id: org.id })),
      ),
    },
  } as unknown as PrismaService;
  return new OrgResolver(prisma);
}

describe('OrgResolver', () => {
  it('uses the only active organization', async () => {
    await expect(resolver([{ id: 'org-1', status: 'ACTIVE' }]).resolve()).resolves.toBe('org-1');
  });

  it('asks for an organization when several are active', async () => {
    await expect(
      resolver([
        { id: 'org-1', status: 'ACTIVE' },
        { id: 'org-2', status: 'ACTIVE' },
      ]).resolve(),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an active organization id and rejects a disabled one', async () => {
    const service = resolver([
      { id: 'org-1', status: 'ACTIVE' },
      { id: 'org-2', status: 'DISABLED' },
    ]);
    await expect(service.resolve('org-1')).resolves.toBe('org-1');
    await expect(service.resolve('org-2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolve('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrgResolver with a review demo company', () => {
  const real: FakeOrg = { id: 'real', status: 'ACTIVE' };
  const demo: FakeOrg = { id: 'demo', status: 'ACTIVE', demoOfId: 'real' };

  it('still picks the only real company when a demo company exists', async () => {
    await expect(resolver([real, demo]).resolve()).resolves.toBe('real');
  });

  it('never resolves the demo company, even when asked for it by id', async () => {
    await expect(resolver([real, demo]).resolve('demo')).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolver([real, demo]).resolve('real')).resolves.toBe('real');
  });

  it('asks for a company when there is no real one', async () => {
    await expect(resolver([demo]).resolve()).rejects.toBeInstanceOf(BadRequestException);
  });
});
