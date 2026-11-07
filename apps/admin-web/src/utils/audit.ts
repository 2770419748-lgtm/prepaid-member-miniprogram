import type { StaffRole } from '../api/types';
import { formatDateTime } from './datetime';
import { SIGN_STATUS } from './esign';
import { formatCent } from './money';
import { maskPhone } from './phone';
import { ROLE_LABEL } from './roles';

type StoreName = (storeId: string) => string | null;

const STATUS_LABEL: Record<string, string> = { ACTIVE: '启用', DISABLED: '停用', DRAFT: '草稿', ARCHIVED: '已下架' };

const SYNC_SOURCE_LABEL: Record<string, string> = { refresh: '刷新状态时同步', webhook: 'e签宝通知' };

function signStatus(value: unknown): string {
  return typeof value === 'string' && value in SIGN_STATUS ? SIGN_STATUS[value as keyof typeof SIGN_STATUS].label : text(value);
}

function isRole(value: unknown): value is StaffRole {
  return value === 'SUPER_ADMIN' || value === 'STORE_MANAGER' || value === 'STAFF';
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * 把一条操作记录的内容翻成几句白话，列表里直接看得懂。
 * 只挑认识的字段；完整内容在详情里看。
 */
export function describeAuditPayload(payload: Record<string, unknown> | null, storeName: StoreName): string[] {
  if (!payload) {
    return [];
  }
  const lines: string[] = [];
  const p = payload;
  if (typeof p.amountCent === 'number') {
    lines.push(`金额 ${formatCent(p.amountCent)} 元`);
  }
  if (typeof p.balanceBefore === 'number' && typeof p.balanceAfter === 'number') {
    lines.push(`余额 ${formatCent(p.balanceBefore)} → ${formatCent(p.balanceAfter)} 元`);
  }
  // 无码抵扣：顾客出示不了会员码，店长或超管按手机号办理，原因写在 remark 里。
  if (p.codeless === true) {
    lines.push(typeof p.orderNo === 'string' ? '没扫会员码' : '没扫会员码，没填九讯云单号');
  }
  // 消费抵扣的收银订单：单号、商品应付金额，手输的标出来。
  if (typeof p.orderNo === 'string') {
    lines.push(`九讯云订单 ${p.orderNo}${p.orderNoTyped === true ? '（手输单号）' : ''}`);
  }
  if (typeof p.productAmountCent === 'number') {
    lines.push(`商品应付 ${formatCent(p.productAmountCent)} 元`);
  }
  // 改会员资料时新旧都记了：称呼、手机号写成「旧 → 新」。
  const renamed = 'previousName' in p;
  if (renamed) {
    lines.push(`称呼 ${text(p.previousName) || '未填'} → ${text(p.name) || '未填'}`);
  }
  const name = renamed ? text(p.title) : text(p.name) || text(p.title);
  if (name) {
    lines.push(`名称 ${name}`);
  }
  if (typeof p.itemCount === 'number') {
    lines.push(`${p.itemCount} 条权益`);
  }
  if (typeof p.esignTemplateId === 'string') {
    lines.push(`e签宝模板 ${p.esignTemplateId}`);
  }
  if (p.from !== undefined && p.to !== undefined) {
    const source = SYNC_SOURCE_LABEL[text(p.source)];
    lines.push(`状态 ${signStatus(p.from)} → ${signStatus(p.to)}${source ? `（${source}）` : ''}`);
  }
  if (p.env === 'SANDBOX') {
    lines.push('测试签署');
  }
  const phoneText = (value: string) => (/^1\d{10}$/.test(value) ? maskPhone(value) : value);
  if (typeof p.previousPhone === 'string' && typeof p.phone === 'string') {
    lines.push(`手机号 ${phoneText(p.previousPhone)} → ${phoneText(p.phone)}`);
  } else if (typeof p.phone === 'string' && p.phone) {
    lines.push(`电话 ${phoneText(p.phone)}`);
  }
  if (isRole(p.role)) {
    const store = typeof p.storeId === 'string' ? storeName(p.storeId) : null;
    lines.push(`${store ? `${store} · ` : ''}${ROLE_LABEL[p.role]}`);
  }
  if (Array.isArray(p.roles)) {
    const roles = p.roles
      .map((r: unknown) => {
        const item = r as { storeId?: unknown; role?: unknown };
        if (!isRole(item.role)) {
          return '';
        }
        const store = typeof item.storeId === 'string' ? storeName(item.storeId) : null;
        return `${store ?? '某门店'} · ${ROLE_LABEL[item.role]}`;
      })
      .filter(Boolean);
    lines.push(roles.length > 0 ? `角色改为 ${roles.join('、')}` : '移除了全部门店角色');
  }
  if (typeof p.status === 'string' && STATUS_LABEL[p.status]) {
    lines.push(`状态改为${STATUS_LABEL[p.status]}`);
  }
  if (typeof p.address === 'string') {
    lines.push(`地址 ${p.address}`);
  }
  if (typeof p.businessHours === 'string') {
    lines.push(`营业时间 ${p.businessHours}`);
  }
  if (typeof p.remark === 'string' && p.remark) {
    lines.push(`${p.codeless === true ? '无码原因' : '备注'} ${p.remark}`);
  }
  if (p.mustChangePassword === true) {
    lines.push('下次登录需改密码');
  }
  // 打开审核体验入口：开到什么时候、是不是延长、是不是第一次建演示公司。
  if (typeof p.until === 'string') {
    lines.push(`${p.extended === true ? '延长到' : '开到'} ${formatDateTime(p.until)}`);
  }
  if (p.demoCreated === true) {
    lines.push('建好了演示公司和演示数据');
  }
  const reason = text(p.reason);
  if (reason) {
    lines.push(`原因 ${reason}`);
  }
  return lines;
}
