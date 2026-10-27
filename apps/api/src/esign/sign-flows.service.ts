import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Prisma, SignFlowStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { PageResult } from '../common/page';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorage } from '../storage/object-storage';
import { EsignClient, SignPosition } from './client/esign.client';
import { CancelSignFlowDto, CreateSignFlowDto, SignFlowListQueryDto } from './dto/sign-flow.dto';
import { signFlowInclude, SignFlowRecord, SignFlowView, toSignFlowView } from './esign.view';
import { SignFlowSyncService } from './sign-flow-sync.service';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** 会员签名落在「会员签字」关键字右侧这么多（单位：PDF 点）。企业章直接盖在关键字上。 */
const MEMBER_SIGN_OFFSET_X = 80;

/** 发起中途进程退出留下的草稿，超过这个时间视为作废，可以重新发起。 */
const STALE_DRAFT_MS = 2 * 60 * 1000;

/**
 * 模板里可以放的填写控件（componentKey）。只填模板里真的有的。
 * 会员称呼不是实名，实名由会员在 e签宝签署页自己核验。
 */
export const TEMPLATE_FIELDS = {
  contractNo: '合同编号（本系统流程号）',
  memberPhone: '会员手机号',
  memberName: '会员称呼（开卡时登记，可能为空）',
  benefitTitle: '权益方案名称',
  orgName: '商家名称',
  storeName: '发起门店',
  signDate: '发起日期，YYYY-MM-DD',
} as const;

function shanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 40);
  return `${cleaned || '权益单'}.pdf`;
}

/** 店员发起、查看、撤销权益单签署。 */
@Injectable()
export class SignFlowsService {
  private readonly logger = new Logger(SignFlowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly esign: EsignClient,
    private readonly esignConfig: EsignConfigService,
    private readonly sync: SignFlowSyncService,
    private readonly storage: ObjectStorage,
  ) {}

  async create(actor: AccessPrincipal, dto: CreateSignFlowDto): Promise<SignFlowView> {
    assertStoreAccess(actor.roles, dto.storeId);
    if (dto.requestId) {
      const replay = await this.findReplay(actor, dto);
      if (replay) {
        return replay;
      }
    }
    const [store, member, template] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: dto.storeId }, include: { org: { select: { name: true } } } }),
      this.prisma.member.findUnique({ where: { id: dto.memberId } }),
      this.prisma.contractTemplate.findUnique({
        where: { id: dto.templateId },
        include: { benefitPlan: { select: { title: true } } },
      }),
    ]);
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能发起签署');
    }
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException('会员已停用，不能发起签署');
    }
    if (!template || template.orgId !== actor.orgId) {
      throw new NotFoundException('权益单模板不存在');
    }
    if (template.status !== 'ACTIVE') {
      throw new BadRequestException('权益单模板未启用');
    }
    // 先核对环境：开关关闭却配了正式网关时，这里直接拒绝，库里不留任何记录。
    const target = this.esign.target();

    const draft = await this.reserve(actor, dto, template.name, target.env);
    if ('replay' in draft) {
      return draft.replay;
    }

    let launched: { signFlowId: string; fileId: string; signUrl: string | null; env: typeof target.env };
    try {
      const values: Record<string, string> = {
        contractNo: draft.id,
        memberPhone: member.phone,
        memberName: member.name ?? '',
        benefitTitle: template.benefitPlan?.title ?? '',
        orgName: store.org.name,
        storeName: store.name,
        signDate: shanghaiDate(new Date()),
      };
      launched = await this.launch({
        esignTemplateId: template.esignTemplateId,
        title: template.name,
        memberPhone: member.phone,
        memberSignKeyword: template.memberSignKeyword,
        sealKeyword: template.sealKeyword,
        values,
      });
    } catch (error) {
      await this.prisma.signFlow.deleteMany({
        where: { id: draft.id, status: SignFlowStatus.DRAFT, esignFlowId: null },
      });
      throw error;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.signFlow.update({
          where: { id: draft.id },
          data: {
            status: SignFlowStatus.PENDING,
            esignFlowId: launched.signFlowId,
            esignFileId: launched.fileId,
            signUrl: launched.signUrl,
            env: launched.env,
            syncedAt: new Date(),
          },
        });
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          storeId: store.id,
          action: AuditAction.SignFlowCreate,
          targetType: 'SignFlow',
          targetId: draft.id,
          payload: { memberId: member.id, templateId: template.id, env: launched.env },
        });
      });
    } catch (error) {
      // e签宝那边已经建好，本地没记上：撤掉那边的流程，免得会员收到一份系统里查不到的合同。
      await this.esign.revokeSignFlow(launched.signFlowId, '系统登记失败，自动撤销').catch(() => {
        this.logger.error(`orphan esign flow ${launched.signFlowId} could not be revoked`);
      });
      await this.prisma.signFlow.deleteMany({
        where: { id: draft.id, status: SignFlowStatus.DRAFT, esignFlowId: null },
      });
      throw error;
    }
    return this.view(draft.id);
  }

  async list(actor: AccessPrincipal, query: SignFlowListQueryDto): Promise<PageResult<SignFlowView>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SignFlowWhereInput = { orgId: actor.orgId };
    if (query.storeId) {
      assertStoreAccess(actor.roles, query.storeId);
      where.storeId = query.storeId;
    } else if (!isSuperAdmin(actor.roles)) {
      where.storeId = { in: [...new Set(actor.roles.map((role) => role.storeId))] };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.memberId) {
      where.memberId = query.memberId;
    }
    if (query.templateId) {
      where.templateId = query.templateId;
    }
    const [total, rows] = await Promise.all([
      this.prisma.signFlow.count({ where }),
      this.prisma.signFlow.findMany({
        where,
        include: signFlowInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toSignFlowView), total, page, pageSize };
  }

  async get(actor: AccessPrincipal, id: string): Promise<SignFlowView> {
    return toSignFlowView(await this.requireVisible(actor, id));
  }

  async refresh(actor: AccessPrincipal, id: string): Promise<SignFlowView> {
    const flow = await this.requireVisible(actor, id);
    await this.sync.sync(flow.id, 'refresh', 'keep');
    return this.view(flow.id);
  }

  async cancel(actor: AccessPrincipal, id: string, dto: CancelSignFlowDto): Promise<SignFlowView> {
    const flow = await this.requireVisible(actor, id);
    const manager =
      isSuperAdmin(actor.roles) ||
      actor.roles.some((role) => role.role === 'STORE_MANAGER' && role.storeId === flow.storeId);
    if (!manager) {
      throw new ForbiddenException('只有超级管理员或发起门店的店长可以撤销');
    }
    if (flow.status !== SignFlowStatus.PENDING || !flow.esignFlowId) {
      throw new ConflictException('只有待签署的权益单可以撤销');
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('撤销原因不能为空');
    }
    await this.esign.revokeSignFlow(flow.esignFlowId, reason);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.signFlow.updateMany({
        where: { id: flow.id, status: SignFlowStatus.PENDING },
        data: { status: SignFlowStatus.CANCELED, signUrl: null, syncedAt: new Date() },
      });
      if (updated.count === 1) {
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          storeId: flow.storeId,
          action: AuditAction.SignFlowCancel,
          targetType: 'SignFlow',
          targetId: flow.id,
          payload: { memberId: flow.memberId, templateId: flow.templateId, reason },
        });
      }
    });
    return this.view(flow.id);
  }

  async pdf(actor: AccessPrincipal, id: string): Promise<StreamableFile> {
    const flow = await this.requireVisible(actor, id);
    return this.readPdf(flow.pdfObjectKey, flow.title || flow.template.name);
  }

  /** 会员端也用。没归档或文件丢了都按 404。 */
  async readPdf(key: string | null, title: string): Promise<StreamableFile> {
    const bytes = key ? await this.storage.get(key) : null;
    if (!bytes) {
      throw new NotFoundException('合同文件还没有归档');
    }
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `inline; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(safeFileName(title))}`,
      length: bytes.length,
    });
  }

  private async view(id: string): Promise<SignFlowView> {
    const flow = await this.prisma.signFlow.findUniqueOrThrow({ where: { id }, include: signFlowInclude });
    return toSignFlowView(flow);
  }

  private async requireVisible(actor: AccessPrincipal, id: string): Promise<SignFlowRecord> {
    const flow = await this.prisma.signFlow.findUnique({ where: { id }, include: signFlowInclude });
    if (!flow || flow.orgId !== actor.orgId) {
      throw new NotFoundException('权益单不存在');
    }
    if (!isSuperAdmin(actor.roles) && !actor.roles.some((role) => role.storeId === flow.storeId)) {
      throw new NotFoundException('权益单不存在');
    }
    return flow;
  }

  private async findReplay(actor: AccessPrincipal, dto: CreateSignFlowDto): Promise<SignFlowView | null> {
    const existing = await this.prisma.signFlow.findUnique({
      where: { orgId_requestId: { orgId: actor.orgId, requestId: dto.requestId! } },
      include: signFlowInclude,
    });
    if (!existing) {
      return null;
    }
    if (existing.memberId !== dto.memberId || existing.templateId !== dto.templateId) {
      throw new ConflictException('请求号已被另一次发起使用');
    }
    if (existing.status === SignFlowStatus.DRAFT) {
      throw new ConflictException('这次发起还在处理中，请稍后刷新');
    }
    return toSignFlowView(existing);
  }

  /**
   * 先在库里占位（DRAFT），靠部分唯一索引保证同一会员同一模板只有一份未完成的。
   * 占位成功后才去 e签宝，避免两位店员同时点击各发一份、各算一次份数。
   */
  private async reserve(
    actor: AccessPrincipal,
    dto: CreateSignFlowDto,
    title: string,
    env: 'SANDBOX' | 'PRODUCTION',
  ): Promise<{ id: string } | { replay: SignFlowView }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.signFlow.create({
          data: {
            orgId: actor.orgId,
            memberId: dto.memberId,
            templateId: dto.templateId,
            storeId: dto.storeId,
            initiatorStaffId: actor.sub,
            title,
            status: SignFlowStatus.DRAFT,
            env,
            requestId: dto.requestId ?? null,
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        if (dto.requestId) {
          const replay = await this.findReplay(actor, dto);
          if (replay) {
            return { replay };
          }
        }
        const open = await this.prisma.signFlow.findFirst({
          where: {
            memberId: dto.memberId,
            templateId: dto.templateId,
            status: { in: [SignFlowStatus.DRAFT, SignFlowStatus.PENDING] },
          },
        });
        const stale =
          open?.status === SignFlowStatus.DRAFT &&
          open.esignFlowId === null &&
          Date.now() - open.createdAt.getTime() > STALE_DRAFT_MS;
        if (open && stale && attempt === 0) {
          await this.prisma.signFlow.deleteMany({
            where: { id: open.id, status: SignFlowStatus.DRAFT, esignFlowId: null },
          });
          continue;
        }
        throw new ConflictException('该会员还有一份没签完的同类权益单，请等会员签完或撤销后再发起');
      }
    }
    throw new ConflictException('该会员还有一份没签完的同类权益单，请等会员签完或撤销后再发起');
  }

  /** 用模板生成合同 → 找签名和盖章位置 → 在 e签宝发起 → 取会员签署链接。 */
  private async launch(input: {
    esignTemplateId: string;
    title: string;
    memberPhone: string;
    memberSignKeyword: string;
    sealKeyword: string;
    values: Record<string, string>;
  }) {
    const docTemplate = await this.esign.getDocTemplate(input.esignTemplateId);
    const keys = new Set(docTemplate.components.map((component) => component.key));
    const fill = Object.fromEntries(
      Object.entries(input.values).filter(([key, value]) => keys.has(key) && value !== ''),
    );
    const fileName = safeFileName(input.title);
    const { fileId } = await this.esign.fillTemplate(input.esignTemplateId, fileName, fill);
    const positions = await this.esign.findKeywords(fileId, [input.memberSignKeyword, input.sealKeyword]);
    const memberAt = positions.get(input.memberSignKeyword);
    const sealAt = positions.get(input.sealKeyword);
    if (!memberAt) {
      throw new BadRequestException(`合同模板里找不到「${input.memberSignKeyword}」，无法确定会员签名位置`);
    }
    if (!sealAt) {
      throw new BadRequestException(`合同模板里找不到「${input.sealKeyword}」，无法确定商家盖章位置`);
    }
    const memberPosition: SignPosition = { ...memberAt, x: memberAt.x + MEMBER_SIGN_OFFSET_X };
    const { signFlowId, env } = await this.esign.createSignFlow({
      title: input.title,
      fileId,
      fileName,
      memberPhone: input.memberPhone,
      memberPosition,
      sealPosition: sealAt,
      notifyUrl: this.esignConfig.notifyUrl,
      redirectUrl: this.esignConfig.redirectUrl,
    });
    let signUrl: string | null = null;
    try {
      signUrl = await this.esign.getSignUrl(signFlowId, input.memberPhone, this.esignConfig.redirectUrl);
    } catch (error) {
      // 流程已经建好，链接可以晚点取（会员端打开前会重新取）。
      this.logger.warn(`sign url not ready: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    return { signFlowId, fileId, signUrl, env };
  }
}
