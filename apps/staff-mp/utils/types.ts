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

/** 扫会员码以后服务端给的：是哪位会员、余额多少、要在什么时候之前扣款。 */
export interface ScannedPayCode {
  member: MemberCard;
  /** 过了这个时间要请会员刷新会员码重新扫。 */
  expiresAt: string;
}

export type SignFlowStatus = 'DRAFT' | 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';

export interface BenefitItem {
  title: string;
  detail: string | null;
}

/** 权益方案：会员能享受什么。超级管理员在商家后台维护，店员只读。 */
export interface BenefitPlan {
  id: string;
  title: string;
  summary: string | null;
  items: BenefitItem[];
  rules: string | null;
}

/** 权益单模板：绑定电子签平台的合同模板，关联一个权益方案。 */
export interface ContractTemplate {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  benefitPlan: { id: string; title: string } | null;
}

/** 一份权益单（合同）的签署。字段与 docs/backend/m4-esign-sandbox.md 一致。 */
export interface SignFlow {
  id: string;
  title: string;
  status: SignFlowStatus;
  /** SANDBOX 是测试签署。 */
  env: 'SANDBOX' | 'PRODUCTION';
  member: { id: string; phone: string; name: string | null };
  template: { id: string; name: string };
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 顾客的签署链接，只在待签署时有。 */
  signUrl: string | null;
  /** 会员权益金额（分），签完充值到余额。 */
  rechargeAmountCent: number | null;
  /** 签完后自动记的那笔充值。签了还没充上时为空。 */
  rechargeEntryId: string | null;
  hasPdf: boolean;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 开单完成后给顾客扫的会员小程序码。 */
export interface MemberAppCode {
  /** 小程序码图片（data URL）。拿不到时为空。 */
  image: string | null;
  /** 本机演示，没有真的小程序码。 */
  demo: boolean;
  /** 拿不到时的原因。 */
  message: string | null;
}
