import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessPrincipal } from '../auth/access-principal';
import { isSuperAdmin, managedStoreIds } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActionCode, AuditActionLabel } from './audit-log.writer';
import { auditLogInclude, AuditLogView, toAuditLogView } from './audit-log.view';
import { AuditLogQueryDto } from './dto/audit-query.dto';

/**
 * 操作记录只读查询。没有修改和删除。
 * 超级管理员看全公司；店长看自己管的门店里发生的，加上自己做的；店员只看自己做的。会员不能看。
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  actions(): { action: AuditActionCode; label: string }[] {
    return (Object.keys(AuditActionLabel) as AuditActionCode[]).map((action) => ({
      action,
      label: AuditActionLabel[action],
    }));
  }

  async list(actor: AccessPrincipal, query: AuditLogQueryDto): Promise<PageResult<AuditLogView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const filters: Prisma.AuditLogWhereInput[] = [this.scope(actor)];
    if (query.action) {
      filters.push({ action: query.action });
    }
    if (query.actorStaffId) {
      filters.push({ actorStaffId: query.actorStaffId });
    }
    if (query.storeId) {
      filters.push({ storeId: query.storeId });
    }
    if (query.targetType) {
      filters.push({ targetType: query.targetType });
    }
    if (query.targetId) {
      filters.push({ targetId: query.targetId });
    }
    const range = this.range(query);
    if (range) {
      filters.push({ createdAt: range });
    }
    const where: Prisma.AuditLogWhereInput = { AND: filters };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: auditLogInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toAuditLogView), total, page, pageSize };
  }

  /** 看不到的记录一律当作不存在，不透露它在别的门店。 */
  async get(actor: AccessPrincipal, id: string): Promise<AuditLogView> {
    const record = await this.prisma.auditLog.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: auditLogInclude,
    });
    if (!record) {
      throw new NotFoundException('操作记录不存在');
    }
    return toAuditLogView(record);
  }

  private scope(actor: AccessPrincipal): Prisma.AuditLogWhereInput {
    if (isSuperAdmin(actor.roles)) {
      return { orgId: actor.orgId };
    }
    const managed = managedStoreIds(actor.roles);
    return {
      orgId: actor.orgId,
      OR: [{ actorStaffId: actor.sub }, ...(managed.length > 0 ? [{ storeId: { in: managed } }] : [])],
    };
  }

  private range(query: AuditLogQueryDto): Prisma.DateTimeFilter | null {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && to && from >= to) {
      throw new BadRequestException('结束时间要晚于开始时间');
    }
    if (!from && !to) {
      return null;
    }
    return { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  }
}
