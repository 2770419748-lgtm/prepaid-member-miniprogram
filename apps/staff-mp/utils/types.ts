/** 服务端接口的返回结构，字段与 docs/backend/m1-auth-stores.md、m2-ledger.md 一致。金额单位都是分。 */

export type StaffRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STAFF';
export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL';
export type ActiveStatus = 'ACTIVE' | 'DISABLED';

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StaffProfile {
  id: string;
  orgId: string;
  phone: string;
  name: string;
  status: ActiveStatus;
}

export interface StaffLoginResult {
  accessToken: string;
  expiresIn: number;
  staff: StaffProfile;
  roles: { storeId: string; role: StaffRole; storeName: string }[];
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
  /** 超级管理员为真，能操作公司全部门店。 */
  unrestricted: boolean;
  stores: MyStore[];
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
  amountCent: number;
  /** 对余额的实际影响，加为正、减为负。 */
  changeCent: number;
  balanceBefore: number;
  balanceAfter: number;
  remark: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  createdAt: string;
}

export interface MoveResult {
  entry: LedgerEntry;
  balanceCent: number;
  /** 同一个请求号重复提交，返回的是第一次的结果，没有再记一笔。 */
  replayed: boolean;
}
