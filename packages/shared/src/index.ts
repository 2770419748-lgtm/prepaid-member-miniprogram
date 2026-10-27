/** 金额单位：分（cent）。禁止用浮点元记账。 */
export const MONEY_UNIT_CENT = 'cent' as const;

/** 角色枚举预留。鉴权实现属后续里程碑。 */
export const STAFF_ROLES = ['SUPER_ADMIN', 'STORE_MANAGER', 'STAFF'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export interface HealthResponse {
  ok: boolean;
  esignProductionEnabled: boolean;
  db: 'up' | 'down';
}
