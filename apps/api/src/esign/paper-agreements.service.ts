import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Prisma, SignFlowStatus, SignKind } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { AccessPrincipal } from '../auth/access-principal';
import { assertStoreAccess, isSuperAdmin } from '../auth/staff-access';
import { EsignConfigService } from '../esign-config/esign-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorage } from '../storage/object-storage';
import {
  agreementPhotoKey,
  detectImage,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_AGREEMENT,
  UPLOAD_TTL_MS,
} from './agreement-photo';
import { AddAgreementPhotosDto, CreatePaperAgreementDto, RemoveAgreementPhotoDto } from './dto/paper-agreement.dto';
import { PAPER_AGREEMENT_TITLE, SignFlowView } from './esign.view';
import { SignFlowSyncService } from './sign-flow-sync.service';
import { SignFlowsService } from './sign-flows.service';

/** multer 收到的文件（内存里）。只用到这几个字段。 */
export interface UploadedPhotoFile {
  buffer: Buffer;
  size: number;
}

export interface UploadedPhotoView {
  id: string;
  contentType: string;
  sizeBytes: number;
}

const STALE_PHOTO = '有照片没有传成功或已经交过了，请重新选择照片后再提交';

/**
 * 开单上传纸质协议单（坤总 2026-11-05：不签电子合同了，改成上传纸质协议单，会员在小程序里能看）。
 *
 * 店员先把照片一张张传上来（小程序 wx.uploadFile 一次只能传一个文件），再带着照片 id 和会员权益金额交单：
 * 同一事务里建一份已签署的权益单（kind=PAPER）、把照片挂上去、写操作记录；然后经 WalletService 充值，
 * 请求号由权益单派生（和电子签签完充值同一条路），中途出错下次刷新再补，不会多充。
 */
@Injectable()
export class PaperAgreementsService {
  private readonly logger = new Logger(PaperAgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly esignConfig: EsignConfigService,
    private readonly storage: ObjectStorage,
    private readonly sync: SignFlowSyncService,
    private readonly flows: SignFlowsService,
  ) {}

  /** 传一张照片，还没挂到哪份协议单上。只认 JPG / PNG / WebP，按文件头判断。 */
  async uploadPhoto(actor: AccessPrincipal, file: UploadedPhotoFile | undefined): Promise<UploadedPhotoView> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('没有收到照片，请重新上传');
    }
    if (file.buffer.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException('照片太大了（超过 8MB），请重新拍一张');
    }
    const image = detectImage(file.buffer);
    if (!image) {
      throw new BadRequestException('只能上传 JPG 或 PNG 格式的照片');
    }
    const key = agreementPhotoKey(actor.orgId, image.ext);
    await this.storage.put(key, file.buffer, image.contentType);
    try {
      const photo = await this.prisma.agreementPhoto.create({
        data: {
          orgId: actor.orgId,
          uploaderStaffId: actor.sub,
          objectKey: key,
          contentType: image.contentType,
          sizeBytes: file.buffer.length,
        },
        select: { id: true, contentType: true, sizeBytes: true },
      });
      return photo;
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /** 交单：建一份已签署的纸质协议单，挂上照片，充值会员权益金额。 */
  async create(actor: AccessPrincipal, dto: CreatePaperAgreementDto): Promise<SignFlowView> {
    assertStoreAccess(actor.roles, dto.storeId);
    if (this.esignConfig.signMode !== 'PAPER') {
      throw new BadRequestException('现在开单走电子签，不能上传纸质协议单');
    }
    const replay = await this.findReplay(actor, dto);
    if (replay) {
      return replay;
    }
    const [store, member, plan] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: dto.storeId } }),
      this.prisma.member.findUnique({ where: { id: dto.memberId }, include: { wallet: { select: { id: true } } } }),
      dto.benefitPlanId ? this.prisma.benefitPlan.findUnique({ where: { id: dto.benefitPlanId } }) : null,
    ]);
    if (!store || store.orgId !== actor.orgId) {
      throw new NotFoundException('门店不存在');
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException('门店已停用，不能开单');
    }
    if (!member || member.orgId !== actor.orgId) {
      throw new NotFoundException('会员不存在');
    }
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException('会员已停用，不能开单');
    }
    if (!member.wallet) {
      throw new BadRequestException('会员还没开卡，开卡后才能上传协议单');
    }
    if (dto.benefitPlanId && (!plan || plan.orgId !== actor.orgId)) {
      throw new NotFoundException('权益方案不存在');
    }
    if (plan && plan.status !== 'ACTIVE') {
      throw new BadRequestException('这个权益方案没有启用');
    }

    const now = new Date();
    let flowId: string;
    try {
      flowId = await this.prisma.$transaction(async (tx) => {
        await this.assertFreshPhotos(tx, actor, dto.photoIds, now);
        const flow = await tx.signFlow.create({
          data: {
            orgId: actor.orgId,
            memberId: member.id,
            kind: SignKind.PAPER,
            benefitPlanId: plan?.id ?? null,
            storeId: store.id,
            initiatorStaffId: actor.sub,
            title: plan?.title ?? PAPER_AGREEMENT_TITLE,
            status: SignFlowStatus.SIGNED,
            requestId: dto.requestId,
            signedAt: now,
            syncedAt: now,
            rechargeAmountCent: dto.rechargeAmountCent,
          },
          select: { id: true },
        });
        await this.attach(tx, flow.id, dto.photoIds, now);
        await this.audit.write(tx, {
          orgId: actor.orgId,
          actorStaffId: actor.sub,
          storeId: store.id,
          action: AuditAction.PaperAgreementCreate,
          targetType: 'SignFlow',
          targetId: flow.id,
          payload: {
            memberId: member.id,
            ...(plan ? { benefitPlanId: plan.id } : {}),
            rechargeAmountCent: dto.rechargeAmountCent,
            photoCount: dto.photoIds.length,
          },
        });
        return flow.id;
      });
    } catch (error) {
      // 同一请求号的另一次提交（连点、网络重试）刚好先交上了：照片已被那一单挂走，这里会报照片用过了或撞请求号唯一约束。
      // 是这种情况就返回那一单；内容不一样 findReplay 会报 409。
      const again = await this.findReplay(actor, dto);
      if (again) {
        return again;
      }
      throw error;
    }
    await this.creditAndView(flowId);
    return this.flows.view(flowId);
  }

  /** 补传照片（拍糊了、漏拍了背面）。本店员工和超管都能补。 */
  async addPhotos(actor: AccessPrincipal, id: string, dto: AddAgreementPhotosDto): Promise<SignFlowView> {
    const flow = await this.requirePaper(actor, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const active = await tx.agreementPhoto.count({ where: { signFlowId: flow.id, removedAt: null } });
      if (active + dto.photoIds.length > MAX_PHOTOS_PER_AGREEMENT) {
        throw new BadRequestException(
          `一份协议单最多 ${MAX_PHOTOS_PER_AGREEMENT} 张照片，现在已有 ${active} 张`,
        );
      }
      await this.assertFreshPhotos(tx, actor, dto.photoIds, now);
      await this.attach(tx, flow.id, dto.photoIds, now);
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        storeId: flow.storeId,
        action: AuditAction.AgreementPhotoAdd,
        targetType: 'SignFlow',
        targetId: flow.id,
        payload: { memberId: flow.memberId, photoIds: dto.photoIds },
      });
    });
    return this.flows.view(flow.id);
  }

  /**
   * 删掉照错的照片（比如拍成了别的顾客的协议单）。只有超管或开单门店的店长能删，要写原因，至少留一张。
   * 文件从存储里删掉，库里留一行记谁、什么时候、为什么删的。
   */
  async removePhoto(
    actor: AccessPrincipal,
    id: string,
    photoId: string,
    dto: RemoveAgreementPhotoDto,
  ): Promise<SignFlowView> {
    const flow = await this.requirePaper(actor, id);
    const manager =
      isSuperAdmin(actor.roles) ||
      actor.roles.some((role) => role.role === 'STORE_MANAGER' && role.storeId === flow.storeId);
    if (!manager) {
      throw new ForbiddenException('只有超级管理员或开单门店的店长可以删除协议单照片');
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('请写明删除原因');
    }
    const photo = await this.prisma.$transaction(async (tx) => {
      const target = await tx.agreementPhoto.findFirst({
        where: { id: photoId, signFlowId: flow.id, removedAt: null },
      });
      if (!target) {
        throw new NotFoundException('照片不存在或已经删除');
      }
      const active = await tx.agreementPhoto.count({ where: { signFlowId: flow.id, removedAt: null } });
      if (active <= 1) {
        throw new BadRequestException('协议单至少要留一张照片。照错了请先补传正确的照片，再删掉这张');
      }
      const updated = await tx.agreementPhoto.updateMany({
        where: { id: target.id, removedAt: null },
        data: { removedAt: new Date(), removedByStaffId: actor.sub, removeReason: reason },
      });
      if (updated.count !== 1) {
        throw new NotFoundException('照片不存在或已经删除');
      }
      await this.audit.write(tx, {
        orgId: actor.orgId,
        actorStaffId: actor.sub,
        storeId: flow.storeId,
        action: AuditAction.AgreementPhotoRemove,
        targetType: 'SignFlow',
        targetId: flow.id,
        payload: { memberId: flow.memberId, photoId: target.id, reason },
      });
      return target;
    });
    // 库里已经标成删除，接口不会再给出这张；文件删不掉只记日志，不影响结果。
    await this.storage.delete(photo.objectKey).catch((error: unknown) => {
      this.logger.error(
        `delete agreement photo file failed for ${photo.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
    return this.flows.view(flow.id);
  }

  /** 店员和超管看照片：权益单在可见范围内，照片挂在这份单上且没删。 */
  async staffPhoto(actor: AccessPrincipal, id: string, photoId: string): Promise<StreamableFile> {
    const flow = await this.flows.requireVisible(actor, id);
    return this.readPhoto(flow.id, photoId);
  }

  /** 会员和员工共用：读一张挂在这份权益单上的照片。 */
  async readPhoto(flowId: string, photoId: string): Promise<StreamableFile> {
    const photo = await this.prisma.agreementPhoto.findFirst({
      where: { id: photoId, signFlowId: flowId, removedAt: null },
    });
    const bytes = photo ? await this.storage.get(photo.objectKey) : null;
    if (!photo || !bytes) {
      throw new NotFoundException('照片不存在');
    }
    return new StreamableFile(bytes, {
      type: photo.contentType,
      disposition: 'inline',
      length: bytes.length,
    });
  }

  private async requirePaper(actor: AccessPrincipal, id: string) {
    const flow = await this.flows.requireVisible(actor, id);
    if (flow.kind !== SignKind.PAPER) {
      throw new BadRequestException('这份是电子签的权益单，没有纸质协议单照片');
    }
    return flow;
  }

  /** 照片都是这位员工自己刚传的、还没交到哪份单上、没删。 */
  private async assertFreshPhotos(
    tx: Prisma.TransactionClient,
    actor: AccessPrincipal,
    photoIds: string[],
    now: Date,
  ): Promise<void> {
    const photos = await tx.agreementPhoto.findMany({
      where: {
        id: { in: photoIds },
        orgId: actor.orgId,
        uploaderStaffId: actor.sub,
        signFlowId: null,
        removedAt: null,
        createdAt: { gte: new Date(now.getTime() - UPLOAD_TTL_MS) },
      },
      select: { id: true },
    });
    if (photos.length !== new Set(photoIds).size) {
      throw new BadRequestException(STALE_PHOTO);
    }
  }

  /** 挂上去。两次提交同时用同一批照片时，后到的那次在这里对不上数，整笔回滚。 */
  private async attach(tx: Prisma.TransactionClient, flowId: string, photoIds: string[], now: Date): Promise<void> {
    const attached = await tx.agreementPhoto.updateMany({
      where: { id: { in: photoIds }, signFlowId: null, removedAt: null },
      data: { signFlowId: flowId, attachedAt: now },
    });
    if (attached.count !== photoIds.length) {
      throw new ConflictException(STALE_PHOTO);
    }
  }

  /** 交单后马上充值。失败了不报错：单已经交上，店员页面显示「正在充值」，点刷新会再充（同一请求号不会多充）。 */
  private async creditAndView(flowId: string): Promise<void> {
    const flow = await this.prisma.signFlow.findUniqueOrThrow({ where: { id: flowId } });
    await this.sync.creditPaper(flow, 'keep');
  }

  /** 同一请求号交过了：内容一致就返回那一单（顺手补上没充上的钱），不一致就拒绝。 */
  private async findReplay(actor: AccessPrincipal, dto: CreatePaperAgreementDto): Promise<SignFlowView | null> {
    const existing = await this.prisma.signFlow.findUnique({
      where: { orgId_requestId: { orgId: actor.orgId, requestId: dto.requestId } },
    });
    if (!existing) {
      return null;
    }
    if (
      existing.kind !== SignKind.PAPER ||
      existing.memberId !== dto.memberId ||
      existing.storeId !== dto.storeId ||
      existing.rechargeAmountCent !== dto.rechargeAmountCent
    ) {
      throw new ConflictException('请求号已被另一次开单使用');
    }
    if (!existing.rechargeEntryId) {
      await this.sync.creditPaper(existing, 'keep');
    }
    return this.flows.view(existing.id);
  }
}
