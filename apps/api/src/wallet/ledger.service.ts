import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueryDto } from './dto/ledger.dto';
import {
  ledgerInclude,
  LedgerRecord,
  MemberLedgerView,
  StaffLedgerView,
  toMemberLedgerView,
  toStaffLedgerView,
} from './ledger.view';

/**
 * 流水只读查询。没有修改和删除。
 * 超级管理员看全公司；店长和店员只看在自己门店发生的流水；会员只看自己的。
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    principal: AccessPrincipal,
    query: LedgerQueryDto,
  ): Promise<PageResult<StaffLedgerView | MemberLedgerView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.LedgerEntryWhereInput = { orgId: principal.orgId };

    if (principal.principalType === 'MEMBER') {
      if (query.memberId && query.memberId !== principal.sub) {
        throw new ForbiddenException('只能查看自己的明细');
      }
      where.memberId = principal.sub;
    } else if (query.memberId) {
      where.memberId = query.memberId;
    }

    if (query.storeId) {
      if (principal.principalType === 'STAFF') {
        assertStoreAccess(principal.roles, query.storeId);
      }
      where.storeId = query.storeId;
    } else if (principal.principalType === 'STAFF' && !isSuperAdmin(principal.roles)) {
      where.storeId = { in: [...new Set(principal.roles.map((role) => role.storeId))] };
    }

    if (query.type) {
      where.type = query.type;
    }
    const range = this.range(query);
    if (range) {
      where.createdAt = range;
    }

    const [total, rows] = await Promise.all([
      this.prisma.ledgerEntry.count({ where }),
      this.prisma.ledgerEntry.findMany({
        where,
        include: ledgerInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map((row) => this.present(principal, row)), total, page, pageSize };
  }

  async get(principal: AccessPrincipal, id: string): Promise<StaffLedgerView | MemberLedgerView> {
    const entry = await this.prisma.ledgerEntry.findUnique({ where: { id }, include: ledgerInclude });
    if (!entry || entry.orgId !== principal.orgId) {
      throw new NotFoundException('流水不存在');
    }
    if (principal.principalType === 'MEMBER') {
      if (entry.memberId !== principal.sub) {
        throw new NotFoundException('流水不存在');
      }
    } else {
      assertStoreAccess(principal.roles, entry.storeId);
    }
    return this.present(principal, entry);
  }

  private present(principal: AccessPrincipal, entry: LedgerRecord): StaffLedgerView | MemberLedgerView {
    if (principal.principalType === 'MEMBER') {
      return toMemberLedgerView(entry);
    }
    if (principal.principalType === 'STAFF') {
      return toStaffLedgerView(entry);
    }
    throw new UnauthorizedException('登录已失效');
  }

  private range(query: LedgerQueryDto): Prisma.DateTimeFilter | null {
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
