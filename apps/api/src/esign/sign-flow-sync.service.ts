import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { SignFlow, SignFlowStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorage } from '../storage/object-storage';
import { EsignClient } from './client/esign.client';
import { isFinal, mapEsignStatus, nextStatus } from './esign-status';

export type SyncSource = 'webhook' | 'refresh';

export interface SyncResult {
  status: SignFlowStatus;
  changed: boolean;
  /** 已签署但合同文件还没归档成功。 */
  archivePending: boolean;
}

export function contractObjectKey(flow: Pick<SignFlow, 'orgId' | 'id'>): string {
  return `contracts/${flow.orgId}/${flow.id}.pdf`;
}

/**
 * 和 e签宝核对一份流程的状态，签完后把合同 PDF 存进对象存储。
 * 回调和主动刷新共用这一处，结果一致。以 e签宝查询结果为准，不轻信回调内容。
 */
@Injectable()
export class SignFlowSyncService {
  private readonly logger = new Logger(SignFlowSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly esign: EsignClient,
    private readonly storage: ObjectStorage,
  ) {}

  /**
   * archiveErrors=throw：回调用，归档失败返回错误让 e签宝重试。
   * archiveErrors=keep：手动刷新用，状态照常返回，hasPdf 仍为 false，下次刷新再归档。
   */
  async sync(
    flowId: string,
    source: SyncSource,
    archiveErrors: 'throw' | 'keep',
  ): Promise<SyncResult> {
    const flow = await this.prisma.signFlow.findUniqueOrThrow({ where: { id: flowId } });
    if (!flow.esignFlowId) {
      return { status: flow.status, changed: false, archivePending: false };
    }
    let current = flow;
    let changed = false;
    if (!isFinal(flow.status)) {
      const detail = await this.esign.getSignFlowDetail(flow.esignFlowId);
      const status = nextStatus(flow.status, mapEsignStatus(detail.status));
      if (mapEsignStatus(detail.status) === null) {
        this.logger.warn(`unknown esign flow status ${detail.status}`);
      }
      const now = new Date();
      changed = status !== flow.status;
      current = await this.prisma.$transaction(async (tx) => {
        // 只在状态没被别人改过时写，避免回调和刷新同时到时记两条状态变化。
        const updated = await tx.signFlow.updateMany({
          where: { id: flow.id, status: flow.status },
          data: {
            status,
            syncedAt: now,
            ...(status === SignFlowStatus.SIGNED ? { signedAt: detail.finishedAt ?? now } : {}),
            ...(status !== SignFlowStatus.PENDING ? { signUrl: null } : {}),
          },
        });
        if (updated.count === 1 && changed) {
          await this.audit.write(tx, {
            orgId: flow.orgId,
            actorStaffId: null,
            storeId: flow.storeId,
            action: AuditAction.SignFlowStatusChange,
            targetType: 'SignFlow',
            targetId: flow.id,
            payload: { from: flow.status, to: status, env: flow.env, source },
          });
        }
        if (updated.count === 0) {
          changed = false;
        }
        return tx.signFlow.findUniqueOrThrow({ where: { id: flow.id } });
      });
    }
    if (current.status !== SignFlowStatus.SIGNED || current.pdfObjectKey) {
      return { status: current.status, changed, archivePending: false };
    }
    try {
      await this.archive(current);
      return { status: current.status, changed, archivePending: false };
    } catch (error) {
      this.logger.warn(
        `archive contract failed for ${current.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (archiveErrors === 'throw') {
        throw error;
      }
      return { status: current.status, changed, archivePending: true };
    }
  }

  private async archive(flow: SignFlow): Promise<void> {
    if (!flow.esignFlowId) {
      return;
    }
    const files = await this.esign.getSignedFiles(flow.esignFlowId);
    const contract = files[0];
    if (!contract) {
      throw new BadGatewayException('电子签服务还没有给出签好的合同文件');
    }
    const bytes = await this.esign.downloadFile(contract.downloadUrl);
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadGatewayException('下载到的合同不是 PDF');
    }
    const key = contractObjectKey(flow);
    await this.storage.put(key, bytes, 'application/pdf');
    await this.prisma.signFlow.updateMany({
      where: { id: flow.id, pdfObjectKey: null },
      data: { pdfObjectKey: key },
    });
  }
}
