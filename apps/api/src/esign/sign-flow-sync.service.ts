import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { SignFlow, SignFlowStatus } from '@prisma/client';
import { AuditAction, AuditLogWriter } from '../audit/audit-log.writer';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorage } from '../storage/object-storage';
import { WalletService } from '../wallet/wallet.service';
import { EsignClient } from './client/esign.client';
import { isFinal, mapEsignStatus, nextStatus } from './esign-status';

export type SyncSource = 'webhook' | 'refresh';

export interface SyncResult {
  status: SignFlowStatus;
  changed: boolean;
  /** 已签署但合同文件还没归档成功。 */
  archivePending: boolean;
  /** 已签署、带会员权益金额，但还没充上（下次回调或刷新再充）。 */
  rechargePending: boolean;
}

export function contractObjectKey(flow: Pick<SignFlow, 'orgId' | 'id'>): string {
  return `contracts/${flow.orgId}/${flow.id}.pdf`;
}

/**
 * 和 e签宝核对一份流程的状态。签完后：带会员权益金额的先经 WalletService 充值到余额，再把合同 PDF 存进对象存储。
 * 回调和主动刷新共用这一处，结果一致。以 e签宝查询结果为准，不轻信回调内容。
 * 充值和归档都可以重来：充值的请求号由流程号派生，重复调用只记一笔。
 */
@Injectable()
export class SignFlowSyncService {
  private readonly logger = new Logger(SignFlowSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly esign: EsignClient,
    private readonly storage: ObjectStorage,
    private readonly wallet: WalletService,
  ) {}

  /**
   * errors=throw：回调用，充值或归档失败返回错误让 e签宝重试。
   * errors=keep：手动刷新用，状态照常返回，没充上或没归档的下次刷新再做。
   */
  async sync(flowId: string, source: SyncSource, errors: 'throw' | 'keep'): Promise<SyncResult> {
    const flow = await this.prisma.signFlow.findUniqueOrThrow({ where: { id: flowId } });
    if (!flow.esignFlowId) {
      return { status: flow.status, changed: false, archivePending: false, rechargePending: false };
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
    if (current.status !== SignFlowStatus.SIGNED) {
      return { status: current.status, changed, archivePending: false, rechargePending: false };
    }
    // 先充值再归档：钱比合同文件要紧，归档出问题不能拖着不到账。
    let rechargePending = false;
    try {
      await this.credit(current);
    } catch (error) {
      this.logger.error(
        `recharge after signing failed for ${current.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (errors === 'throw') {
        throw error;
      }
      rechargePending = true;
    }
    if (current.pdfObjectKey) {
      return { status: current.status, changed, archivePending: false, rechargePending };
    }
    try {
      await this.archive(current);
      return { status: current.status, changed, archivePending: false, rechargePending };
    } catch (error) {
      this.logger.warn(
        `archive contract failed for ${current.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (errors === 'throw') {
        throw error;
      }
      return { status: current.status, changed, archivePending: true, rechargePending };
    }
  }

  /**
   * 签完后把会员权益金额充进余额，记在发起开单的门店和店员名下。
   * 先记流水再回填 rechargeEntryId：中间断了，下次同步时同一请求号直接拿回那笔，不会多充。
   */
  private async credit(flow: SignFlow): Promise<void> {
    if (flow.rechargeAmountCent === null || flow.rechargeEntryId) {
      return;
    }
    if (!flow.storeId) {
      throw new Error('sign flow with recharge amount has no store');
    }
    const result = await this.wallet.creditSignedContract({
      orgId: flow.orgId,
      memberId: flow.memberId,
      storeId: flow.storeId,
      operatorStaffId: flow.initiatorStaffId,
      signFlowId: flow.id,
      amountCent: flow.rechargeAmountCent,
    });
    await this.prisma.signFlow.updateMany({
      where: { id: flow.id, rechargeEntryId: null },
      data: { rechargeEntryId: result.entry.id },
    });
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
