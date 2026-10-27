import { Test } from '@nestjs/testing';
import { EsignConfigService } from '../src/esign-config/esign-config.service';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';

describe('HealthController', () => {
  async function build(dbUp: boolean): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: EsignConfigService,
          useValue: { productionEnabled: false },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockImplementation(() => {
              if (!dbUp) {
                throw new Error('db down');
              }
              return Promise.resolve([{ '?column?': 1 }]);
            }),
          },
        },
      ],
    }).compile();
    return moduleRef.get(HealthController);
  }

  it('reports esignProductionEnabled false and db up', async () => {
    const controller = await build(true);
    await expect(controller.check()).resolves.toEqual({
      ok: true,
      esignProductionEnabled: false,
      db: 'up',
    });
  });

  it('reports db down without failing the process check', async () => {
    const controller = await build(false);
    await expect(controller.check()).resolves.toEqual({
      ok: true,
      esignProductionEnabled: false,
      db: 'down',
    });
  });
});
