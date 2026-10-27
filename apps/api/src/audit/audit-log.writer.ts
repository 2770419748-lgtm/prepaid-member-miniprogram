import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const AuditAction = {
  StoreCreate: 'STORE_CREATE',
  StoreUpdate: 'STORE_UPDATE',
  StaffCreate: 'STAFF_CREATE',
  StaffUpdate: 'STAFF_UPDATE',
  StaffRolesReplace: 'STAFF_ROLES_REPLACE',
  StaffPasswordChange: 'STAFF_PASSWORD_CHANGE',
  StaffPasswordReset: 'STAFF_PASSWORD_RESET',
  MemberIdentityCreate: 'MEMBER_IDENTITY_CREATE',
  MemberCardOpen: 'MEMBER_CARD_OPEN',
  WalletRecharge: 'WALLET_RECHARGE',
  WalletConsume: 'WALLET_CONSUME',
  WalletReversal: 'WALLET_REVERSAL',
  BenefitPlanCreate: 'BENEFIT_PLAN_CREATE',
  BenefitPlanUpdate: 'BENEFIT_PLAN_UPDATE',
  ContractTemplateCreate: 'CONTRACT_TEMPLATE_CREATE',
  ContractTemplateUpdate: 'CONTRACT_TEMPLATE_UPDATE',
  /** 发起签署成功时写，与 e签宝流程登记在同一事务。 */
  SignFlowCreate: 'SIGN_FLOW_CREATE',
  SignFlowCancel: 'SIGN_FLOW_CANCEL',
  /** e签宝回调或主动核对后状态变化（签完、拒签、过期、撤销）。系统写入，没有操作人。 */
  SignFlowStatusChange: 'SIGN_FLOW_STATUS_CHANGE',
} as const;

export type AuditActionCode = (typeof AuditAction)[keyof typeof AuditAction];

/** 后台筛选和列表里显示的中文名。新增 action 时一起加。 */
export const AuditActionLabel: Record<AuditActionCode, string> = {
  STORE_CREATE: '新建门店',
  STORE_UPDATE: '修改门店',
  STAFF_CREATE: '新建员工',
  STAFF_UPDATE: '修改员工',
  STAFF_ROLES_REPLACE: '调整员工角色',
  STAFF_PASSWORD_CHANGE: '修改密码',
  STAFF_PASSWORD_RESET: '重置密码',
  MEMBER_IDENTITY_CREATE: '会员首次登录',
  MEMBER_CARD_OPEN: '开卡',
  WALLET_RECHARGE: '充值',
  WALLET_CONSUME: '消费扣款',
  WALLET_REVERSAL: '冲正',
  BENEFIT_PLAN_CREATE: '新建权益方案',
  BENEFIT_PLAN_UPDATE: '修改权益方案',
  CONTRACT_TEMPLATE_CREATE: '新建合同模板',
  CONTRACT_TEMPLATE_UPDATE: '修改合同模板',
  SIGN_FLOW_CREATE: '发起签署',
  SIGN_FLOW_CANCEL: '取消签署',
  SIGN_FLOW_STATUS_CHANGE: '签署状态变化',
};

export interface AuditWriteInput {
  orgId: string;
  actorStaffId?: string | null;
  /** 操作发生在哪家门店。与门店无关的操作不填。 */
  storeId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Prisma.InputJsonValue;
}

type AuditTx = {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
};

/**
 * 操作记录的唯一写入口。查询见 AuditQueryService。
 * 调用方应放在同一事务里，避免事情没做成却留下记录。记录只追加，数据库拒绝修改和删除。
 */
@Injectable()
export class AuditLogWriter {
  async write(tx: AuditTx, entry: AuditWriteInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        orgId: entry.orgId,
        actorStaffId: entry.actorStaffId ?? null,
        storeId: entry.storeId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payloadJson: entry.payload,
      },
    });
  }
}
