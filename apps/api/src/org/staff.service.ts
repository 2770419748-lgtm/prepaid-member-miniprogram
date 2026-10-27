import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffRole, StaffStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { hashPassword } from '../auth/password';
import { assertCanManageStore, isSuperAdmin, managedStoreIds } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStaffDto,
  ReplaceStaffRolesDto,
  ResetStaffPasswordDto,
  StaffListQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffRoleView, StaffView, toStaffView } from './staff.view';
import { toStoreView } from './store.view';

const staffInclude = {
  storeRoles: { include: { store: { select: { id: true, name: true } } } },
} satisfies Prisma.StaffInclude;

type StaffWithRoles = Prisma.StaffGetPayload<{ include: typeof staffInclude }>;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async list(actor: AccessPrincipal, query: StaffListQueryDto): Promise<PageResult<StaffView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const scope = this.managerScope(actor);
    if (query.storeId) {
      await this.assertStoreInScope(actor, query.storeId, scope);
    }
    const where: Prisma.StaffWhereInput = { orgId: actor.orgId };
    if (query.storeId) {
      where.storeRoles = { some: { storeId: query.storeId } };
    } else if (scope) {
      where.storeRoles = { some: { storeId: { in: scope } } };
    }
    const [total, rows] = await Promise.all([
      this.prisma.staff.count({ where }),
      this.prisma.staff.findMany({
        where,
        include: staffInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map((row) => this.present(actor, row)), total, page, pageSize };
  }

  async myStores(actor: AccessPrincipal) {
    if (isSuperAdmin(actor.roles)) {
      const stores = await this.prisma.store.findMany({
        where: { orgId: actor.orgId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return {
        unrestricted: true,
        stores: stores.map((store) => ({
          ...this.storeCard(store),
          role: StaffRole.SUPER_ADMIN,
        })),
      };
    }
    const ids = actor.roles.map((role) => role.storeId);
    const stores = await this.prisma.store.findMany({
      where: { orgId: actor.orgId, id: { in: ids } },
    });
    const byId = new Map(stores.map((store) => [store.id, store]));
    return {
      unrestricted: false,
      stores: actor.roles.flatMap((role) => {
        const store = byId.get(role.storeId);
        if (!store) {
          return [];
        }
        return [
          {
            ...this.storeCard(store),
            role: role.role,
          },
        ];
      }),
    };
  }

  async create(actor: AccessPrincipal, dto: CreateStaffDto): Promise<StaffView> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('姓名不能为空');
    }
    const store = await this.requireStore(actor.orgId, dto.storeId);
    if (!isSuperAdmin(actor.roles)) {
      assertCanManageStore(actor.roles, store.id);
      if (dto.role !== StaffRole.STAFF) {
        throw new ForbiddenException('店长只能新建普通店员');
      }
    }
    const passwordHash = await hashPassword(dto.password);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const staff = await tx.staff.create({
          data: {
            orgId: actor.orgId,
            phone: dto.phone,
            name,
            status: StaffStatus.ACTIVE,
            passwordHash,
            mustChangePassword: true,
            storeRoles: { create: { storeId: store.id, role: dto.role } },
          },
          include: staffInclude,
        });
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          storeId: store.id,
          action: AuditAction.StaffCreate,
          targetType: 'Staff',
          targetId: staff.id,
          payload: { phone: staff.phone, name: staff.name, storeId: store.id, role: dto.role },
        });
        return staff;
      });
      return this.present(actor, created);
    } catch (error) {
      this.rethrowPhoneConflict(error);
    }
  }

  async update(actor: AccessPrincipal, staffId: string, dto: UpdateStaffDto): Promise<StaffView> {
    if (dto.name === undefined && dto.status === undefined && dto.phone === undefined) {
      throw new BadRequestException('没有可更新字段');
    }
    const current = await this.requireStaff(actor.orgId, staffId);
    const data: Prisma.StaffUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('姓名不能为空');
      }
      data.name = name;
    }
    if (!isSuperAdmin(actor.roles)) {
      this.assertManagerCanTouch(actor, current);
      if (dto.phone !== undefined) {
        throw new ForbiddenException('不能修改手机号');
      }
      if (dto.status !== undefined && this.hasStoreOutside(actor, current)) {
        throw new ForbiddenException('该员工还属于其他门店，不能在这里停用');
      }
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone;
    }
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const staff = await tx.staff.update({
          where: { id: current.id },
          data,
          include: staffInclude,
        });
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          action: AuditAction.StaffUpdate,
          targetType: 'Staff',
          targetId: staff.id,
          payload: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          },
        });
        return staff;
      });
      return this.present(actor, updated);
    } catch (error) {
      this.rethrowPhoneConflict(error);
    }
  }

  async replaceRoles(
    actor: AccessPrincipal,
    staffId: string,
    dto: ReplaceStaffRolesDto,
  ): Promise<StaffView> {
    const storeIds = dto.roles.map((role) => role.storeId);
    if (new Set(storeIds).size !== storeIds.length) {
      throw new BadRequestException('同一门店不能重复分配角色');
    }
    const current = await this.requireStaff(actor.orgId, staffId);
    await this.assertStoresInOrg(actor.orgId, storeIds);
    const superAdmin = isSuperAdmin(actor.roles);
    const managed = managedStoreIds(actor.roles);
    if (!superAdmin) {
      if (actor.sub === current.id) {
        throw new ForbiddenException('不能修改自己的角色');
      }
      if (current.storeRoles.some((role) => role.role === StaffRole.SUPER_ADMIN)) {
        throw new ForbiddenException('无权修改超级管理员');
      }
      if (current.storeRoles.some((role) => role.role === StaffRole.STORE_MANAGER)) {
        throw new ForbiddenException('不能修改店长的角色');
      }
      if (managed.length === 0) {
        throw new ForbiddenException('无权执行该操作');
      }
      for (const role of dto.roles) {
        if (role.role === StaffRole.SUPER_ADMIN) {
          throw new ForbiddenException('不可分配超级管理员');
        }
        if (role.role !== StaffRole.STAFF) {
          throw new ForbiddenException('店长只能分配普通店员');
        }
        if (!managed.includes(role.storeId)) {
          throw new ForbiddenException('无权操作该门店');
        }
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (superAdmin) {
        await tx.staffStoreRole.deleteMany({ where: { staffId: current.id } });
      } else {
        await tx.staffStoreRole.deleteMany({
          where: { staffId: current.id, storeId: { in: managed } },
        });
      }
      if (dto.roles.length > 0) {
        await tx.staffStoreRole.createMany({
          data: dto.roles.map((role) => ({
            staffId: current.id,
            storeId: role.storeId,
            role: role.role,
          })),
        });
      }
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.StaffRolesReplace,
        targetType: 'Staff',
        targetId: current.id,
        payload: {
          roles: dto.roles.map((role) => ({ storeId: role.storeId, role: role.role })),
        },
      });
      return tx.staff.findUniqueOrThrow({ where: { id: current.id }, include: staffInclude });
    });
    return this.present(actor, updated);
  }

  async resetPassword(
    actor: AccessPrincipal,
    staffId: string,
    dto: ResetStaffPasswordDto,
  ): Promise<StaffView> {
    if (!isSuperAdmin(actor.roles)) {
      throw new ForbiddenException('无权执行该操作');
    }
    const current = await this.requireStaff(actor.orgId, staffId);
    const passwordHash = await hashPassword(dto.password);
    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.update({
        where: { id: current.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
        include: staffInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.StaffPasswordReset,
        targetType: 'Staff',
        targetId: staff.id,
        payload: { mustChangePassword: true },
      });
      return staff;
    });
    return this.present(actor, updated);
  }

  private storeCard(store: Parameters<typeof toStoreView>[0]) {
    const view = toStoreView(store);
    return {
      id: view.id,
      name: view.name,
      status: view.status,
      address: view.address,
      lat: view.lat,
      lng: view.lng,
      phone: view.phone,
      businessHours: view.businessHours,
    };
  }

  private managerScope(actor: AccessPrincipal): string[] | null {
    if (isSuperAdmin(actor.roles)) {
      return null;
    }
    const ids = managedStoreIds(actor.roles);
    if (ids.length === 0) {
      throw new ForbiddenException('无权执行该操作');
    }
    return ids;
  }

  private async assertStoreInScope(
    actor: AccessPrincipal,
    storeId: string,
    scope: string[] | null,
  ): Promise<void> {
    const store = await this.requireStore(actor.orgId, storeId);
    if (scope && !scope.includes(store.id)) {
      throw new ForbiddenException('无权操作该门店');
    }
  }

  private assertManagerCanTouch(actor: AccessPrincipal, staff: StaffWithRoles): void {
    if (staff.storeRoles.some((role) => role.role === StaffRole.SUPER_ADMIN)) {
      throw new ForbiddenException('无权修改超级管理员');
    }
    if (staff.id === actor.sub || staff.storeRoles.some((role) => role.role === StaffRole.STORE_MANAGER)) {
      throw new ForbiddenException('不能修改店长');
    }
    const managed = new Set(managedStoreIds(actor.roles));
    if (!staff.storeRoles.some((role) => managed.has(role.storeId))) {
      throw new ForbiddenException('无权操作该门店');
    }
  }

  private hasStoreOutside(actor: AccessPrincipal, staff: StaffWithRoles): boolean {
    const managed = new Set(managedStoreIds(actor.roles));
    return staff.storeRoles.some((role) => !managed.has(role.storeId));
  }

  private present(actor: AccessPrincipal, staff: StaffWithRoles): StaffView {
    const visible = staff.storeRoles.filter((role) => {
      if (isSuperAdmin(actor.roles)) {
        return true;
      }
      return managedStoreIds(actor.roles).includes(role.storeId);
    });
    const roles: StaffRoleView[] = visible.map((role) => ({
      storeId: role.storeId,
      role: role.role,
      storeName: role.store.name,
    }));
    return toStaffView(staff, roles);
  }

  private async requireStore(orgId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.orgId !== orgId) {
      throw new NotFoundException('门店不存在');
    }
    return store;
  }

  private async requireStaff(orgId: string, staffId: string): Promise<StaffWithRoles> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      include: staffInclude,
    });
    if (!staff || staff.orgId !== orgId) {
      throw new NotFoundException('员工不存在');
    }
    return staff;
  }

  private async assertStoresInOrg(orgId: string, storeIds: string[]): Promise<void> {
    if (storeIds.length === 0) {
      return;
    }
    const count = await this.prisma.store.count({
      where: { orgId, id: { in: [...new Set(storeIds)] } },
    });
    if (count !== new Set(storeIds).size) {
      throw new NotFoundException('门店不存在');
    }
  }

  private rethrowPhoneConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('手机号已存在');
    }
    throw error;
  }
}
