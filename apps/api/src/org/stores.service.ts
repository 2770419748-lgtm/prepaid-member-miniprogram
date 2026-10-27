import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertCanManageStore, assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto, StoreListQueryDto, UpdateStoreDto } from './dto/store.dto';
import { StoreView, toStoreView } from './store.view';

function requireName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new BadRequestException('门店名称不能为空');
  }
  return name;
}

function cleanAddress(value: string): string | null {
  const address = value.trim();
  return address.length > 0 ? address : null;
}

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async list(actor: AccessPrincipal, query: StoreListQueryDto): Promise<PageResult<StoreView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.StoreWhereInput = { orgId: actor.orgId };
    if (query.status) {
      where.status = query.status;
    }
    if (!isSuperAdmin(actor.roles)) {
      where.id = { in: actor.roles.map((role) => role.storeId) };
    }
    const [total, rows] = await Promise.all([
      this.prisma.store.count({ where }),
      this.prisma.store.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toStoreView), total, page, pageSize };
  }

  async get(actor: AccessPrincipal, storeId: string): Promise<StoreView> {
    const store = await this.requireStore(actor.orgId, storeId);
    assertStoreAccess(actor.roles, store.id);
    return toStoreView(store);
  }

  async create(actor: AccessPrincipal, dto: CreateStoreDto): Promise<StoreView> {
    if (!isSuperAdmin(actor.roles)) {
      throw new ForbiddenException('无权执行该操作');
    }
    const name = requireName(dto.name);
    const created = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          orgId: actor.orgId,
          name,
          address: dto.address === undefined ? null : cleanAddress(dto.address),
          status: StoreStatus.ACTIVE,
        },
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.StoreCreate,
        targetType: 'Store',
        targetId: store.id,
        payload: { name: store.name, address: store.address },
      });
      return store;
    });
    return toStoreView(created);
  }

  async update(actor: AccessPrincipal, storeId: string, dto: UpdateStoreDto): Promise<StoreView> {
    if (dto.name === undefined && dto.address === undefined && dto.status === undefined) {
      throw new BadRequestException('没有可更新字段');
    }
    const current = await this.requireStore(actor.orgId, storeId);
    if (!isSuperAdmin(actor.roles)) {
      assertCanManageStore(actor.roles, current.id);
      if (dto.status !== undefined) {
        throw new ForbiddenException('无权修改门店状态');
      }
    }
    const data: Prisma.StoreUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = requireName(dto.name);
    }
    if (dto.address !== undefined) {
      data.address = cleanAddress(dto.address);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.update({ where: { id: current.id }, data });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.StoreUpdate,
        targetType: 'Store',
        targetId: store.id,
        payload: {
          ...(dto.name !== undefined ? { name: data.name } : {}),
          ...(dto.address !== undefined ? { address: data.address } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      return store;
    });
    return toStoreView(updated);
  }

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.orgId !== orgId) {
      throw new NotFoundException('门店不存在');
    }
    return store;
  }
}
