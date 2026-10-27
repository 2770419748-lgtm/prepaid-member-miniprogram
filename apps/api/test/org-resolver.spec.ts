import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgResolver } from '../src/auth/org-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';

function resolver(orgs: { id: string; status: 'ACTIVE' | 'DISABLED' }[]): OrgResolver {
  const prisma = {
    org: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return orgs.find((org) => org.id === where.id) ?? null;
      }),
      findMany: jest.fn(async () => orgs.filter((org) => org.status === 'ACTIVE').slice(0, 2)),
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
