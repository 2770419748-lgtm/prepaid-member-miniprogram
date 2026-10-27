import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertMainlandMobile, normalizePhone } from '../auth/phone';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { MemberListQueryDto, OpenCardDto } from './dto/member-card.dto';
import { memberCardInclude, MemberCardView, toMemberCardView } from './member.view';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * 店员办理开卡、查会员。
 * 开卡 = 一位会员 + 一只余额为 0 的钱包，同一事务写入。会员先在小程序登录过也没关系，补开钱包即可。
 */
@Injectable()
export class MemberCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async open(actor: AccessPrincipal, dto: OpenCardDto): Promise<MemberCardView> {
    assertStoreAccess(actor.roles, dto.storeId);
    const phone = normalizePhone(dto.phone);
    assertMainlandMobile(phone);
    const name = dto.name?.trim() || null;
    const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能开卡');
    }
    try {
      return await this.openOnce(actor, phone, name, store.id);
    } catch (error) {
      // 会员恰好同时在小程序首次登录，或两位店员同时开同一个号。重读一次再判断。
      if (isUniqueViolation(error)) {
        try {
          return await this.openOnce(actor, phone, name, store.id);
        } catch (retryError) {
          if (isUniqueViolation(retryError)) {
            throw new ConflictException('该手机号已开卡');
          }
          throw retryError;
        }
      }
      throw error;
    }
  }

  async list(actor: AccessPrincipal, query: MemberListQueryDto): Promise<PageResult<MemberCardView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const filters: Prisma.MemberWhereInput[] = [{ orgId: actor.orgId }];
    const exactPhone = query.phone ? normalizePhone(query.phone) : null;
    if (exactPhone) {
      assertMainlandMobile(exactPhone);
      filters.push({ phone: exactPhone });
    } else if (!isSuperAdmin(actor.roles)) {
      const storeIds = [...new Set(actor.roles.map((role) => role.storeId))];
      filters.push({
        OR: [{ openStoreId: { in: storeIds } }, { ledger: { some: { storeId: { in: storeIds } } } }],
      });
    }
    const keyword = query.keyword?.trim();
    if (keyword) {
      filters.push({
        OR: [{ phone: { contains: keyword } }, { name: { contains: keyword, mode: 'insensitive' } }],
      });
    }
    const where: Prisma.MemberWhereInput = { AND: filters };
    const [total, rows] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({
        where,
        include: memberCardInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toMemberCardView), total, page, pageSize };
  }

  /** 任何门店的店员都能看会员的总余额：会员可以到任一门店消费。 */
  async get(actor: AccessPrincipal, memberId: string): Promise<MemberCardView> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: memberCardInclude,
    });
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    return toMemberCardView(member);
  }

  private async openOnce(
    actor: AccessPrincipal,
    phone: string,
    name: string | null,
    storeId: string,
  ): Promise<MemberCardView> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.member.findUnique({
        where: { orgId_phone: { orgId: actor.orgId, phone } },
        include: { wallet: { select: { id: true } } },
      });
      if (existing?.status === 'DISABLED') {
        throw new ConflictException('该会员已停用');
      }
      if (existing?.wallet) {
        throw new ConflictException('该手机号已开卡');
      }
      const member = existing
        ? await tx.member.update({
            where: { id: existing.id },
            data: {
              openStoreId: storeId,
              ...(name ? { name } : {}),
              wallet: { create: { balanceCent: 0, version: 0 } },
            },
            include: memberCardInclude,
          })
        : await tx.member.create({
            data: {
              orgId: actor.orgId,
              phone,
              name,
              openStoreId: storeId,
              status: 'ACTIVE',
              wallet: { create: { balanceCent: 0, version: 0 } },
            },
            include: memberCardInclude,
          });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        storeId,
        action: AuditAction.MemberCardOpen,
        targetType: 'Member',
        targetId: member.id,
        payload: { phone, name, storeId, existedBefore: existing != null },
      });
      return toMemberCardView(member);
    });
  }
}
