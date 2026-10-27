/** 和 apps/api 的返回结构对应。金额字段一律是整数分。 */

export type StaffRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STAFF';
export type ActiveStatus = 'ACTIVE' | 'DISABLED';
export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL';

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
  reversedById: string | null;
  createdAt: string;
}

export interface MoneyMoveResult {
  entry: LedgerEntry;
  balanceCent: number;
  /** 同一个请求号重复提交时为真：返回的是第一次的结果，没有再记一笔。 */
  replayed: boolean;
}
