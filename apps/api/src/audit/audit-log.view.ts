import { Prisma } from '@prisma/client';
import { AuditActionLabel } from './audit-log.writer';

export const auditLogInclude = {
  actor: { select: { name: true } },
  store: { select: { name: true } },
} satisfies Prisma.AuditLogInclude;

export type AuditLogRecord = Prisma.AuditLogGetPayload<{ include: typeof auditLogInclude }>;

export interface AuditLogView {
  id: string;
  action: string;
  /** 中文名。未知的 action 原样返回。 */
  actionLabel: string;
  actorStaffId: string | null;
  actorName: string | null;
  storeId: string | null;
  storeName: string | null;
  targetType: string | null;
  targetId: string | null;
  /** 当时记下的快照。手机号已打码（门店联系电话除外）。 */
  payload: Prisma.JsonValue;
  createdAt: string;
}

export function labelOf(action: string): string {
  return (AuditActionLabel as Record<string, string>)[action] ?? action;
}

/** 138****0000。不是手机号的长度也只留头尾。 */
export function maskPhone(value: string): string {
  if (value.length >= 7) {
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }
  return '****';
}

/** 记录里可能出现会员、员工手机号的字段。换手机号时新旧两个都有。 */
const PHONE_FIELDS = ['phone', 'previousPhone'] as const;

/** 会员和员工的手机号在操作记录里打码；门店联系电话本来就公开给会员，不打码。 */
function present(payload: Prisma.JsonValue, targetType: string | null): Prisma.JsonValue {
  if (targetType === 'Store' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  let masked: Prisma.JsonObject | null = null;
  for (const field of PHONE_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string') {
      masked = { ...(masked ?? payload), [field]: maskPhone(value) };
    }
  }
  return masked ?? payload;
}

export function toAuditLogView(record: AuditLogRecord): AuditLogView {
  return {
    id: record.id,
    action: record.action,
    actionLabel: labelOf(record.action),
    actorStaffId: record.actorStaffId,
    actorName: record.actor?.name ?? null,
    storeId: record.storeId,
    storeName: record.store?.name ?? null,
    targetType: record.targetType,
    targetId: record.targetId,
    payload: present(record.payloadJson, record.targetType),
    createdAt: record.createdAt.toISOString(),
  };
}
