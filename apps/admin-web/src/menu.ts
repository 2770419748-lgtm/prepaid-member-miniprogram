import type { StaffRole } from './api/types';

export type MenuIcon = 'dashboard' | 'member' | 'billing' | 'org' | 'benefit' | 'audit';

export interface MenuEntry {
  /** 路由名。 */
  key: string;
  label: string;
  /** 至少要这个角色才显示。 */
  minRole?: StaffRole;
  /** 只给超级管理员看。 */
  superAdminOnly?: boolean;
}

export interface MenuGroup extends Partial<MenuEntry> {
  key: string;
  label: string;
  icon: MenuIcon;
  children?: MenuEntry[];
}

/** 菜单配置表。角色码只在这里和路由 meta 里出现，页面不写死。 */
export const MENU: MenuGroup[] = [
  { key: 'dashboard', label: '概览', icon: 'dashboard' },
  {
    key: 'g-member',
    label: '会员',
    icon: 'member',
    children: [
      { key: 'member-open', label: '开卡' },
      { key: 'members', label: '会员查询' },
    ],
  },
  {
    key: 'g-billing',
    label: '记账',
    icon: 'billing',
    children: [
      { key: 'recharge', label: '充值记账' },
      { key: 'consume', label: '消费扣款' },
      { key: 'ledger', label: '流水查询' },
    ],
  },
  {
    key: 'g-org',
    label: '门店与员工',
    icon: 'org',
    children: [
      { key: 'stores', label: '门店管理' },
      { key: 'staff', label: '员工管理', minRole: 'STORE_MANAGER' },
    ],
  },
  {
    key: 'g-benefit',
    label: '权益单',
    icon: 'benefit',
    children: [
      { key: 'sign-flows', label: '发起与签署' },
      { key: 'benefit-templates', label: '模板配置', superAdminOnly: true },
    ],
  },
  {
    key: 'g-audit',
    label: '对账与记录',
    icon: 'audit',
    children: [
      { key: 'reconciliation', label: '当日对账' },
      { key: 'audit-logs', label: '操作记录' },
    ],
  },
];

/** 按当前账号的角色过滤菜单。没有可见子项的分组整组隐藏。 */
export function buildMenu(atLeast: (role: StaffRole) => boolean, superAdmin: boolean): MenuGroup[] {
  const visible = (entry: Partial<MenuEntry>): boolean =>
    (!entry.minRole || atLeast(entry.minRole)) && (!entry.superAdminOnly || superAdmin);
  return MENU.flatMap((group) => {
    if (!visible(group)) {
      return [];
    }
    if (!group.children) {
      return [group];
    }
    const children = group.children.filter(visible);
    return children.length > 0 ? [{ ...group, children }] : [];
  });
}
