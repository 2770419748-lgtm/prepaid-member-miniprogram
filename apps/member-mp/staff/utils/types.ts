/** 服务端接口的返回结构，字段与 docs/backend/m1-auth-stores.md、m2-ledger.md 一致。金额单位都是分。 */

export type StaffRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STAFF';
/** REFUND 是退余额：店长或超级管理员在商家后台把没用完的储值退给顾客。 */
export type LedgerType = 'RECHARGE' | 'CONSUME' | 'REVERSAL' | 'REFUND';
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
  principalType: 'STAFF';
  staff: StaffProfile;
  roles: { storeId: string; role: StaffRole; storeName: string }[];
}

/** 工作台「切到我的会员卡」换来的会员登录。 */
export interface OwnMemberSession {
  accessToken: string;
  expiresIn: number;
  principalType: 'MEMBER';
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
  /** 冲正抵掉的是哪一类。不是冲正为空。 */
  reversalOfType?: LedgerType | null;
  reversedById: string | null;
  /** 消费抵扣的九讯云订单号（A+数字）；冲正流水显示被冲那笔的订单号。2026-11-05 以前的消费为空。 */
  orderNo?: string | null;
  /** 那张订单的商品应付金额，分。只有带订单号的消费有。 */
  productAmountCent?: number | null;
  /** 订单号是店员手输的。 */
  orderNoTyped?: boolean | null;
  /** 无码抵扣：没扫会员码，店长按手机号办理。原因在 remark。 */
  codeless?: boolean;
  createdAt: string;
}

/** 扫到订单码后先查一下这张单抵过没有（全公司范围）。 */
export interface OrderCheck {
  /** 整理后的订单号，如 A5982。 */
  orderNo: string;
  redeemed: {
    entryId: string;
    storeName: string;
    amountCent: number;
    productAmountCent: number | null;
    createdAt: string;
  } | null;
  /** 抵过时的提示（哪天在哪家店抵了多少）。 */
  message: string | null;
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

/** 开单怎么签：PAPER 上传顾客签字的纸质协议单（2026-11-05 起默认），ESIGN 电子签。 */
export type SignMode = 'PAPER' | 'ESIGN';

export interface SignConfig {
  mode: SignMode;
  /** 一份协议单最多几张照片。 */
  maxPhotos: number;
  /** 一张照片最大多少字节。 */
  maxPhotoBytes: number;
}

/** 刚传上去、还没交单的一张协议单照片。 */
export interface UploadedPhoto {
  id: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * 一份权益单。kind=PAPER 是纸质协议单（照片在 photos 里，交单即已签署并充值），ESIGN 是电子签。
 * 字段与 docs/backend/paper-agreement.md、m4-esign-sandbox.md 一致。
 */
export interface SignFlow {
  id: string;
  title: string;
  kind: 'ESIGN' | 'PAPER';
  status: SignFlowStatus;
  env: 'SANDBOX' | 'PRODUCTION';
  /** 电子签沙箱，界面标「测试签署」。纸质协议单永远是 false。 */
  sandbox: boolean;
  member: { id: string; phone: string; name: string | null };
  /** 电子签模板。纸质协议单为空。 */
  template: { id: string; name: string } | null;
  benefitPlan: { id: string; title: string } | null;
  store: { id: string; name: string } | null;
  initiator: { id: string; name: string } | null;
  /** 顾客的签署链接，只在待签署时有。 */
  signUrl: string | null;
  /** 会员权益金额（分），签完充值到余额。 */
  rechargeAmountCent: number | null;
  /** 签完后自动记的那笔充值。签了还没充上时为空。 */
  rechargeEntryId: string | null;
  /** 那笔充值后来被冲正了。 */
  rechargeReversed: boolean;
  hasPdf: boolean;
  /** 纸质协议单的照片（没删的）。 */
  photos: { id: string; createdAt: string }[];
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
