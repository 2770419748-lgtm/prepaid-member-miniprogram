import type { MyStoresResult, SignConfig, SignFlow, SignFlowStatus, SignMode } from './types';

/**
 * 开单一条龙：输顾客手机号 → 填会员权益金额、选权益 → 拍照上传顾客签字的纸质协议单 → 上传即充值到账 → 顾客扫会员小程序码登录。
 * 坤总 2026-11-05 定：不签电子合同了，改成上传纸质协议单（SIGN_MODE=paper，默认）。
 * 电子签那一套（顾客扫码签合同、签完才到账，坤总 2026-10-29 定）保留，开关打开（SIGN_MODE=esign）时照旧。
 */
export type OrderStep = 'phone' | 'benefit' | 'upload' | 'sign' | 'done';

const STEPS: Record<SignMode, { key: OrderStep; label: string }[]> = {
  PAPER: [
    { key: 'phone', label: '手机号' },
    { key: 'benefit', label: '填权益' },
    { key: 'upload', label: '传协议单' },
    { key: 'done', label: '到账' },
  ],
  ESIGN: [
    { key: 'phone', label: '手机号' },
    { key: 'benefit', label: '填权益' },
    { key: 'sign', label: '签合同' },
    { key: 'done', label: '到账' },
  ],
};

export interface StepDot {
  key: OrderStep;
  label: string;
  /** 走过的显示勾，当前的高亮。 */
  state: 'done' | 'current' | 'todo';
  index: number;
}

export function stepDots(current: OrderStep, mode: SignMode = 'PAPER'): StepDot[] {
  const steps = STEPS[mode];
  const at = steps.findIndex((step) => step.key === current);
  return steps.map((step, index) => ({
    ...step,
    index: index + 1,
    state: index < at ? 'done' : index === at ? 'current' : 'todo',
  }));
}

/** 取不到开单设置时按纸质协议单（坤总 2026-11-05 的决定）。和服务端 GET /sign-flows/config 的默认值一致。 */
export const DEFAULT_SIGN_CONFIG: SignConfig = { mode: 'PAPER', maxPhotos: 9, maxPhotoBytes: 8 * 1024 * 1024 };

/** 本机记着上次取到的开单方式，首页、会员页的说明文字不用每次等接口。 */
export const SIGN_MODE_KEY = 'staff.sign_mode';

export function readSignMode(value: unknown): SignMode {
  return value === 'ESIGN' ? 'ESIGN' : 'PAPER';
}

/** 两种开单方式下给店员看的说明。 */
export const ORDER_TEXT: Record<
  SignMode,
  { entry: string; memberEntry: string; noCard: string; phoneRules: string; amountTip: string }
> = {
  PAPER: {
    entry: '输入顾客手机号，填会员权益金额，上传顾客签字的协议单后充值到账',
    memberEntry: '填会员权益金额，上传顾客签字的协议单后充值到账',
    noCard: '该会员还没开卡。开单时会一起开卡，上传协议单后充值到账。',
    phoneRules: '输入手机号后填写会员权益，再拍照上传顾客签了字的纸质协议单。新顾客在上传协议单时开卡；上传成功，会员权益金额立即充值到账。',
    amountTip: '上传顾客签字的协议单后，充值到会员余额',
  },
  ESIGN: {
    entry: '输入顾客手机号，填会员权益金额，顾客签完合同自动充值',
    memberEntry: '填会员权益金额，顾客签完合同自动充值',
    noCard: '该会员还没开卡。开单时会一起开卡，签完合同充值到账。',
    phoneRules: '输入手机号后直接填写会员权益、生成合同。新顾客在生成合同时开卡；顾客签完合同，会员权益金额才充值到账。',
    amountTip: '写进合同，顾客签完后充值到会员余额',
  },
};

/** 一张照片能不能传：太大的不收（服务端也会拦）。能传返回空串。 */
export function photoProblem(sizeBytes: number, maxBytes: number): string {
  if (sizeBytes > maxBytes) {
    return `有照片超过 ${Math.round(maxBytes / 1024 / 1024)}MB，请重新拍一张`;
  }
  return '';
}

/** 纸质协议单交上去以后：钱充上了就是到账，没充上（中途出错）就显示正在充值，点刷新再补。 */
export function paperProgress(flow: Pick<SignFlow, 'rechargeAmountCent' | 'rechargeEntryId'>): 'done' | 'recharging' {
  return flow.rechargeAmountCent != null && !flow.rechargeEntryId ? 'recharging' : 'done';
}

/** 签署页隔多久问一次签好没有；自动问十分钟，之后要店员点「刷新状态」。 */
export const POLL_MS = 4000;
export const POLL_LIMIT_MS = 10 * 60 * 1000;

export type SignProgress =
  | { kind: 'waiting' }
  | { kind: 'recharging' }
  | { kind: 'done' }
  | { kind: 'ended'; title: string; text: string };

const ENDED: Partial<Record<SignFlowStatus, { title: string; text: string }>> = {
  REJECTED: { title: '顾客拒签了这份合同', text: '会员权益金额没有充值。和顾客确认后可以重新开单。' },
  EXPIRED: { title: '合同已过期', text: '顾客没有在有效期内签署，会员权益金额没有充值。请重新开单。' },
  CANCELED: { title: '合同已撤销', text: '这份合同已经撤销，会员权益金额没有充值。' },
};

/** 合同走到哪一步：等顾客签、签了正在充值、充好了、没签成。 */
export function signProgress(flow: Pick<SignFlow, 'status' | 'rechargeAmountCent' | 'rechargeEntryId'>): SignProgress {
  if (flow.status === 'SIGNED') {
    return flow.rechargeAmountCent != null && !flow.rechargeEntryId ? { kind: 'recharging' } : { kind: 'done' };
  }
  const ended = ENDED[flow.status];
  return ended ? { kind: 'ended', ...ended } : { kind: 'waiting' };
}

/** 和服务端一致：超级管理员，或发起这份合同的门店的店长，才能撤销。 */
export function canCancelFlow(flow: Pick<SignFlow, 'status' | 'store'>, access: MyStoresResult): boolean {
  if (flow.status !== 'PENDING') {
    return false;
  }
  if (access.unrestricted) {
    return true;
  }
  return access.stores.some((store) => store.id === flow.store?.id && store.role === 'STORE_MANAGER');
}

/** 去开单页：带手机号从头开始，带会员号直接填权益，带合同号接着签（电子签）。 */
export function orderUrl(from: { phone?: string; memberId?: string; flowId?: string } = {}): string {
  const query = (Object.keys(from) as (keyof typeof from)[])
    .filter((key) => from[key])
    .map((key) => `${key}=${encodeURIComponent(from[key] as string)}`);
  return query.length ? `/staff/pages/order/order?${query.join('&')}` : '/staff/pages/order/order';
}

/** 本机演示时画的码，写明是演示，扫了也打不开。 */
export const DEMO_APP_CODE_TEXT = '储值会员小程序（本机演示码，正式上线后换成小程序码）';
