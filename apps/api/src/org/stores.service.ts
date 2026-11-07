import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertCanManageStore, assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreDto, StoreImportDto, StoreListQueryDto, UpdateStoreDto } from './dto/store.dto';
import { planStoreImport, StoreImportResult, summarizeImport } from './store-import';
import { StoreView, toStoreView } from './store.view';

function requireName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new BadRequestException('门店名称不能为空');
  }
  return name;
}

function cleanText(value: string): string | null {
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(6));
}

/** 修改时：两个都传空则清空；两个都是数字则写入；只传一边则拒绝。 */
function applyCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { lat: Prisma.Decimal | null; lng: Prisma.Decimal | null } {
  if (lat === null && lng === null) {
    return { lat: null, lng: null };
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat: toDecimal(lat), lng: toDecimal(lng) };
  }
  throw new BadRequestException('经纬度需要同时填写');
}

/** 新建时：两个都空则不记坐标。只填一个则拒绝。 */
function requiredCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { lat: Prisma.Decimal | null; lng: Prisma.Decimal | null } {
  if ((lat === undefined || lat === null) && (lng === undefined || lng === null)) {
    return { lat: null, lng: null };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new BadRequestException('经纬度需要同时填写');
  }
  return { lat: toDecimal(lat), lng: toDecimal(lng) };
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
        // 按建店先后排，和小程序会员看到的顺序、批量导入时表格里的顺序一样。
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
    const coords = requiredCoords(dto.lat, dto.lng);
    const created = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          orgId: actor.orgId,
          name,
          address: dto.address === undefined ? null : cleanText(dto.address),
          lat: coords.lat,
          lng: coords.lng,
          contactPhone: dto.phone === undefined ? null : cleanText(dto.phone),
          businessHours: dto.businessHours === undefined ? null : cleanText(dto.businessHours),
          status: StoreStatus.ACTIVE,
        },
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        storeId: store.id,
        action: AuditAction.StoreCreate,
        targetType: 'Store',
        targetId: store.id,
        payload: {
          name: store.name,
          address: store.address,
          lat: coords.lat == null ? null : coords.lat.toNumber(),
          lng: coords.lng == null ? null : coords.lng.toNumber(),
          phone: store.contactPhone,
          businessHours: store.businessHours,
        },
      });
      return store;
    });
    return toStoreView(created);
  }

  async update(actor: AccessPrincipal, storeId: string, dto: UpdateStoreDto): Promise<StoreView> {
    if (
      dto.name === undefined &&
      dto.address === undefined &&
      dto.status === undefined &&
      dto.lat === undefined &&
      dto.lng === undefined &&
      dto.phone === undefined &&
      dto.businessHours === undefined
    ) {
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
      data.address = cleanText(dto.address);
    }
    if (dto.phone !== undefined) {
      data.contactPhone = cleanText(dto.phone);
    }
    if (dto.businessHours !== undefined) {
      data.businessHours = cleanText(dto.businessHours);
    }
    if (dto.lat !== undefined || dto.lng !== undefined) {
      const coords = applyCoords(dto.lat, dto.lng);
      data.lat = coords.lat;
      data.lng = coords.lng;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.update({ where: { id: current.id }, data });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        storeId: store.id,
        action: AuditAction.StoreUpdate,
        targetType: 'Store',
        targetId: store.id,
        payload: {
          ...(dto.name !== undefined ? { name: data.name } : {}),
          ...(dto.address !== undefined ? { address: data.address } : {}),
          ...(dto.phone !== undefined ? { phone: data.contactPhone } : {}),
          ...(dto.businessHours !== undefined ? { businessHours: data.businessHours } : {}),
          ...(dto.lat !== undefined || dto.lng !== undefined
            ? {
                lat: data.lat instanceof Prisma.Decimal ? data.lat.toNumber() : null,
                lng: data.lng instanceof Prisma.Decimal ? data.lng.toNumber() : null,
              }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      return store;
    });
    return toStoreView(updated);
  }

  /**
   * 用表格批量录门店（仅超级管理员）。按门店名称对上已有门店：只补上填了且不一样的项，空格子不动；
   * 名称对不上的新建（营业中）。dryRun 只列出会怎么处理；真正导入时有一行不对就整批不导。
   * 每家新建或改动的门店各写一条操作记录，带 source: 'import'。
   */
  async importStores(actor: AccessPrincipal, dto: StoreImportDto): Promise<StoreImportResult> {
    if (!isSuperAdmin(actor.roles)) {
      throw new ForbiddenException('无权执行该操作');
    }
    if (dto.dryRun) {
      const existing = await this.prisma.store.findMany({ where: { orgId: actor.orgId } });
      return summarizeImport(true, planStoreImport(dto.rows, existing).items);
    }
    return this.prisma.$transaction(
      async (tx) => {
        // 两个人同时导入时排队，免得同一个名字建出两家。只锁公司这一行，不影响记账。
        await tx.$queryRaw`SELECT 1 FROM "orgs" WHERE "id" = ${actor.orgId} FOR NO KEY UPDATE`;
        const existing = await tx.store.findMany({ where: { orgId: actor.orgId } });
        const plan = planStoreImport(dto.rows, existing);
        const failed = plan.items.filter((item) => item.action === 'ERROR').length;
        if (failed > 0) {
          throw new BadRequestException(`表格里有 ${failed} 行要先改好，这次一家都没导入`);
        }
        for (const [i, item] of plan.items.entries()) {
          const row = plan.rows[i];
          if (!row || item.action === 'UNCHANGED') {
            continue;
          }
          const coords =
            row.lat !== undefined && row.lng !== undefined
              ? { lat: row.lat.toNumber(), lng: row.lng.toNumber() }
              : null;
          if (item.action === 'CREATE') {
            const store = await tx.store.create({
              data: {
                orgId: actor.orgId,
                name: row.name,
                address: row.address ?? null,
                contactPhone: row.phone ?? null,
                businessHours: row.businessHours ?? null,
                lat: row.lat ?? null,
                lng: row.lng ?? null,
                status: StoreStatus.ACTIVE,
              },
            });
            item.storeId = store.id;
            await this.audit.write(tx, {
              orgId: actor.orgId,
              actorStaffId: actor.sub,
              storeId: store.id,
              action: AuditAction.StoreCreate,
              targetType: 'Store',
              targetId: store.id,
              payload: {
                name: store.name,
                address: store.address,
                lat: coords?.lat ?? null,
                lng: coords?.lng ?? null,
                phone: store.contactPhone,
                businessHours: store.businessHours,
                source: 'import',
              },
            });
            continue;
          }
          const storeId = item.storeId as string;
          const data: Prisma.StoreUpdateInput = {};
          const payload: Record<string, string | number | null> = {};
          if (item.changes.includes('address')) {
            data.address = row.address;
            payload.address = row.address ?? null;
          }
          if (item.changes.includes('phone')) {
            data.contactPhone = row.phone;
            payload.phone = row.phone ?? null;
          }
          if (item.changes.includes('businessHours')) {
            data.businessHours = row.businessHours;
            payload.businessHours = row.businessHours ?? null;
          }
          if (item.changes.includes('location') && coords) {
            data.lat = row.lat;
            data.lng = row.lng;
            payload.lat = coords.lat;
            payload.lng = coords.lng;
          }
          await tx.store.update({ where: { id: storeId }, data });
          await this.audit.write(tx, {
            orgId: actor.orgId,
            actorStaffId: actor.sub,
            storeId,
            action: AuditAction.StoreUpdate,
            targetType: 'Store',
            targetId: storeId,
            payload: { ...payload, source: 'import' },
          });
        }
        return summarizeImport(false, plan.items);
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  }

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.orgId !== orgId) {
      throw new NotFoundException('门店不存在');
    }
    return store;
  }
}
