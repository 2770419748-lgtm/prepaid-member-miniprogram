import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BenefitPlanStatus, Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import {
  BenefitItemDto,
  BenefitPlanListQueryDto,
  CreateBenefitPlanDto,
  UpdateBenefitPlanDto,
} from './dto/benefit-plan.dto';
import {
  BenefitContent,
  benefitPlanInclude,
  BenefitPlanView,
  readBenefitContent,
  toBenefitContentJson,
  toBenefitPlanView,
} from './esign.view';

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return text;
}

function optionalText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function cleanItems(items: BenefitItemDto[]) {
  return items.map((item) => ({
    title: requireText(item.title, '权益条目'),
    detail: optionalText(item.detail),
  }));
}

/** 权益方案：会员能享受什么。超管维护，店员只读，会员在小程序里看。 */
@Injectable()
export class BenefitPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async list(actor: AccessPrincipal, query: BenefitPlanListQueryDto): Promise<PageResult<BenefitPlanView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.BenefitPlanWhereInput = { orgId: actor.orgId };
    if (query.status) {
      where.status = query.status;
    }
    const [total, rows] = await Promise.all([
      this.prisma.benefitPlan.count({ where }),
      this.prisma.benefitPlan.findMany({
        where,
        include: benefitPlanInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toBenefitPlanView), total, page, pageSize };
  }

  async get(actor: AccessPrincipal, id: string): Promise<BenefitPlanView> {
    return toBenefitPlanView(await this.require(actor.orgId, id));
  }

  async create(actor: AccessPrincipal, dto: CreateBenefitPlanDto): Promise<BenefitPlanView> {
    const content: BenefitContent = {
      summary: optionalText(dto.summary),
      items: cleanItems(dto.items),
      rules: optionalText(dto.rules),
    };
    const title = requireText(dto.title, '权益方案名称');
    const status = dto.status ?? BenefitPlanStatus.ACTIVE;
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.benefitPlan.create({
        data: { orgId: actor.orgId, title, status, contentJson: toBenefitContentJson(content) },
        include: benefitPlanInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.BenefitPlanCreate,
        targetType: 'BenefitPlan',
        targetId: created.id,
        payload: { title, status, itemCount: content.items.length },
      });
      return created;
    });
    return toBenefitPlanView(plan);
  }

  async update(actor: AccessPrincipal, id: string, dto: UpdateBenefitPlanDto): Promise<BenefitPlanView> {
    if (
      dto.title === undefined &&
      dto.summary === undefined &&
      dto.items === undefined &&
      dto.rules === undefined &&
      dto.status === undefined
    ) {
      throw new BadRequestException('没有可更新字段');
    }
    const current = await this.require(actor.orgId, id);
    const content = readBenefitContent(current.contentJson);
    if (dto.summary !== undefined) {
      content.summary = optionalText(dto.summary);
    }
    if (dto.items !== undefined) {
      content.items = cleanItems(dto.items);
    }
    if (dto.rules !== undefined) {
      content.rules = optionalText(dto.rules);
    }
    const data: Prisma.BenefitPlanUpdateInput = { contentJson: toBenefitContentJson(content) };
    if (dto.title !== undefined) {
      data.title = requireText(dto.title, '权益方案名称');
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.benefitPlan.update({
        where: { id: current.id },
        data,
        include: benefitPlanInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.BenefitPlanUpdate,
        targetType: 'BenefitPlan',
        targetId: updated.id,
        payload: {
          fields: Object.keys(dto).filter((key) => dto[key as keyof UpdateBenefitPlanDto] !== undefined),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      return updated;
    });
    return toBenefitPlanView(plan);
  }

  private async require(orgId: string, id: string) {
    const plan = await this.prisma.benefitPlan.findUnique({ where: { id }, include: benefitPlanInclude });
    if (!plan || plan.orgId !== orgId) {
      throw new NotFoundException('权益方案不存在');
    }
    return plan;
  }
}
