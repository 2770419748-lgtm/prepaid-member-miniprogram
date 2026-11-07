/** 和 apps/api 的返回结构对应。金额字段一律是整数分。 */

export type StaffRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STAFF';
export type ActiveStatus = 'ACTIVE' | 'DISABLED';
/** REFUND 是退余额：把会员没用完的储值退给顾客（钱线下退）。 */
export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL' | 'REFUND';

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface RoleView {
  storeId: string;
  role: StaffRole;
  storeName?: string;
}

export interface StaffSummary {
  id: string;
  orgId: string;
  phone: string;
  name: string;
  status: ActiveStatus;
}

export interface StaffLoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  principalType: 'STAFF';
  mustChangePassword: boolean;
  staff: StaffSummary;
  roles: RoleView[];
}

export interface StaffMeResult {
  principalType: 'STAFF';
  staff: StaffSummary & { mustChangePassword: boolean };
  roles: RoleView[];
}

export interface StoreView {
  id: string;
  orgId: string;
  name: string;
  status: ActiveStatus;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  businessHours: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyStore {
  id: string;
  name: string;
  status: ActiveStatus;
  address: string | null;
  phone: string | null;
  businessHours: string | null;
  role: StaffRole;
}

export interface MyStoresResult {
  unrestricted: boolean;
  stores: MyStore[];
}

export interface StaffView {
  id: string;
  orgId: string;
  phone: string;
  name: string;
  status: ActiveStatus;
  wxOpenId: string | null;
  mustChangePassword: boolean;
  roles: RoleView[];
}

export interface MemberCard {
  id: string;
  phone: string;
  name: string | null;
  status: ActiveStatus;
  hasCard: boolean;
  openStoreId: string | null;
  openStoreName: string | null;
  /** 全公司通用的总余额。没开卡时为空。 */
  balanceCent: number | null;
  openedAt: string | null;
  wechatBound: boolean;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  memberId: string;
  memberPhone: string;
  memberName: string | null;
  storeId: string;
  storeName: string;
  operatorStaffId: string | null;
  operatorName: string | null;
  type: LedgerType;
  /** 金额绝对值。 */
  amountCent: number;
  /** 对余额的实际影响：加为正，减为负。 */
  changeCent: number;
  balanceBefore: number;
  balanceAfter: number;
  remark: string | null;
  reversalOfId: string | null;
  /** 冲正抵掉的是哪一类。不是冲正为空。 */
  reversalOfType: LedgerType | null;
  reversedById: string | null;
  /** 消费抵扣的九讯云订单号（如 A5982）；冲正记录带的是原消费的单号。其他流水为空。 */
  orderNo: string | null;
  /** 这张单的商品应付金额（分），抵扣最多它的 10%，且一单最多 1000 元。只有消费有。 */
  productAmountCent: number | null;
  /** 单号是店员手输的（条码扫不出来时）。只有消费有。 */
  orderNoTyped: boolean | null;
  /** 无码抵扣：顾客出示不了会员码，店长或超管按手机号直接抵扣；原因在 remark。 */
  codeless: boolean;
  createdAt: string;
}

export interface MoneyMoveResult {
  entry: LedgerEntry;
  balanceCent: number;
  /** 同一个请求号重复提交时为真：返回的是第一次的结果，没有再记一笔。 */
  replayed: boolean;
}
