import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractTemplateStatus, Prisma } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { PageResult } from '../common/page';
import { PrismaService } from '../prisma/prisma.service';
import { EsignApiError, EsignClient } from './client/esign.client';
import {
  ContractTemplateListQueryDto,
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract-template.dto';
import { contractTemplateInclude, ContractTemplateView, toContractTemplateView } from './esign.view';

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return text;
}

/**
 * 权益单模板：把 e签宝文件模板绑到本系统。
 * 绑定和换绑时到 e签宝核对模板是否存在，免得发起时才发现填错。
 */
@Injectable()
export class ContractTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly esign: EsignClient,
  ) {}

  async list(
    actor: AccessPrincipal,
    query: ContractTemplateListQueryDto,
  ): Promise<PageResult<ContractTemplateView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ContractTemplateWhereInput = { orgId: actor.orgId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.benefitPlanId) {
      where.benefitPlanId = query.benefitPlanId;
    }
    const [total, rows] = await Promise.all([
      this.prisma.contractTemplate.count({ where }),
      this.prisma.contractTemplate.findMany({
        where,
        include: contractTemplateInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toContractTemplateView), total, page, pageSize };
  }

  async get(actor: AccessPrincipal, id: string): Promise<ContractTemplateView> {
    return toContractTemplateView(await this.require(actor.orgId, id));
  }

  async create(actor: AccessPrincipal, dto: CreateContractTemplateDto): Promise<ContractTemplateView> {
    const name = requireText(dto.name, '模板名称');
    if (dto.benefitPlanId) {
      await this.requirePlan(actor.orgId, dto.benefitPlanId);
    }
    await this.verifyEsignTemplate(dto.esignTemplateId);
    const status = dto.status ?? ContractTemplateStatus.ACTIVE;
    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contractTemplate.create({
        data: {
          orgId: actor.orgId,
          esignTemplateId: dto.esignTemplateId,
          name,
          status,
          benefitPlanId: dto.benefitPlanId ?? null,
          ...(dto.memberSignKeyword ? { memberSignKeyword: requireText(dto.memberSignKeyword, '签名关键字') } : {}),
          ...(dto.sealKeyword ? { sealKeyword: requireText(dto.sealKeyword, '盖章关键字') } : {}),
        },
        include: contractTemplateInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.ContractTemplateCreate,
        targetType: 'ContractTemplate',
        targetId: created.id,
        payload: {
          name,
          esignTemplateId: created.esignTemplateId,
          benefitPlanId: created.benefitPlanId,
          status,
        },
      });
      return created;
    });
    return toContractTemplateView(template);
  }

  async update(
    actor: AccessPrincipal,
    id: string,
    dto: UpdateContractTemplateDto,
  ): Promise<ContractTemplateView> {
    const fields = Object.keys(dto).filter(
      (key) => dto[key as keyof UpdateContractTemplateDto] !== undefined,
    );
    if (fields.length === 0) {
      throw new BadRequestException('没有可更新字段');
    }
    const current = await this.require(actor.orgId, id);
    const data: Prisma.ContractTemplateUncheckedUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = requireText(dto.name, '模板名称');
    }
    if (dto.benefitPlanId !== undefined) {
      if (dto.benefitPlanId !== null) {
        await this.requirePlan(actor.orgId, dto.benefitPlanId);
      }
      data.benefitPlanId = dto.benefitPlanId;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.memberSignKeyword !== undefined) {
      data.memberSignKeyword = requireText(dto.memberSignKeyword, '签名关键字');
    }
    if (dto.sealKeyword !== undefined) {
      data.sealKeyword = requireText(dto.sealKeyword, '盖章关键字');
    }
    if (dto.esignTemplateId !== undefined && dto.esignTemplateId !== current.esignTemplateId) {
      await this.verifyEsignTemplate(dto.esignTemplateId);
      data.esignTemplateId = dto.esignTemplateId;
    }
    const template = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.contractTemplate.update({
        where: { id: current.id },
        data,
        include: contractTemplateInclude,
      });
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        action: AuditAction.ContractTemplateUpdate,
        targetType: 'ContractTemplate',
        targetId: updated.id,
        payload: {
          fields,
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(data.esignTemplateId !== undefined ? { esignTemplateId: updated.esignTemplateId } : {}),
        },
      });
      return updated;
    });
    return toContractTemplateView(template);
  }

  private async verifyEsignTemplate(esignTemplateId: string): Promise<void> {
    try {
      await this.esign.getDocTemplate(esignTemplateId);
    } catch (error) {
      if (error instanceof EsignApiError) {
        throw new BadRequestException(`e签宝里找不到这个模板：${error.esignMessage || error.esignCode}`);
      }
      throw error;
    }
  }

  private async requirePlan(orgId: string, id: string): Promise<void> {
    const plan = await this.prisma.benefitPlan.findUnique({ where: { id }, select: { orgId: true } });
    if (!plan || plan.orgId !== orgId) {
      throw new NotFoundException('权益方案不存在');
    }
  }

  private async require(orgId: string, id: string) {
    const template = await this.prisma.contractTemplate.findUnique({
      where: { id },
      include: contractTemplateInclude,
    });
    if (!template || template.orgId !== orgId) {
      throw new NotFoundException('权益单模板不存在');
    }
    return template;
  }
}
