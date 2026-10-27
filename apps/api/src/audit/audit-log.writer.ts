import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const AuditAction = {
  StoreCreate: 'STORE_CREATE',
  StoreUpdate: 'STORE_UPDATE',
  StaffCreate: 'STAFF_CREATE',
  StaffUpdate: 'STAFF_UPDATE',
  StaffRolesReplace: 'STAFF_ROLES_REPLACE',
  MemberIdentityCreate: 'MEMBER_IDENTITY_CREATE',
} as const;

export interface AuditWriteInput {
  orgId: string;
  actorStaffId?: string | null;
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
 * 只负责把关键写操作记下来。查询、对账留给后续里程碑。
 * 调用方应放在同一事务里，避免事情没做成却留下记录。
 */
@Injectable()
export class AuditLogWriter {
  async write(tx: AuditTx, entry: AuditWriteInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        orgId: entry.orgId,
        actorStaffId: entry.actorStaffId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payloadJson: entry.payload,
      },
    });
  }
}
