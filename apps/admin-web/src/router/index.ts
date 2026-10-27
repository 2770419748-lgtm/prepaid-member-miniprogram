import { message } from 'ant-design-vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { handleUnauthorized } from '../api/http';
import type { StaffRole } from '../api/types';
import AdminLayout from '../layouts/AdminLayout.vue';
import { useSessionStore } from '../stores/session';
import LoginView from '../views/LoginView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    /** 不需要登录。 */
    public?: boolean;
    /** 至少要这个角色才能进；菜单也按它隐藏。 */
    minRole?: StaffRole;
    /** 菜单里高亮哪一项（详情页高亮所属列表）。 */
    menuKey?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { title: '登录', public: true } },
  {
    path: '/change-password',
    name: 'change-password',
    component: () => import('../views/ChangePasswordView.vue'),
    meta: { title: '修改密码' },
  },
  {
    path: '/',
    component: AdminLayout,
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: '概览' },
      },
      {
        path: 'members/open',
        name: 'member-open',
        component: () => import('../views/members/OpenCardView.vue'),
        meta: { title: '开卡' },
      },
      {
        path: 'members',
        name: 'members',
        component: () => import('../views/members/MemberListView.vue'),
        meta: { title: '会员查询' },
      },
      {
        path: 'members/:id',
        name: 'member-detail',
        component: () => import('../views/members/MemberDetailView.vue'),
        meta: { title: '会员详情', menuKey: 'members' },
      },
      {
        path: 'billing/recharge',
        name: 'recharge',
        component: () => import('../views/billing/RechargeView.vue'),
        meta: { title: '充值记账' },
      },
      {
        path: 'billing/consume',
        name: 'consume',
        // 消费必须在员工小程序扫会员码，旧链接进来给提示。
        component: () => import('../views/billing/ConsumeMovedView.vue'),
        meta: { title: '消费扣款', menuKey: 'ledger' },
      },
      {
        path: 'ledger',
        name: 'ledger',
        component: () => import('../views/ledger/LedgerView.vue'),
        meta: { title: '流水查询' },
      },
      {
        path: 'stores',
        name: 'stores',
        component: () => import('../views/org/StoreListView.vue'),
        meta: { title: '门店管理' },
      },
      {
        path: 'staff',
        name: 'staff',
        component: () => import('../views/org/StaffListView.vue'),
        meta: { title: '员工管理', minRole: 'STORE_MANAGER' },
      },
      {
        path: 'benefits/templates',
        name: 'benefit-templates',
        component: () => import('../views/benefits/BenefitTemplatesView.vue'),
        meta: { title: '权益单模板', minRole: 'SUPER_ADMIN' },
      },
      {
        path: 'benefits/sign-flows',
        name: 'sign-flows',
        component: () => import('../views/benefits/SignFlowsView.vue'),
        meta: { title: '权益单签署' },
      },
      {
        path: 'reconciliation',
        name: 'reconciliation',
        component: () => import('../views/audit/ReconciliationView.vue'),
        meta: { title: '当日对账' },
      },
      {
        path: 'audit-logs',
        name: 'audit-logs',
        component: () => import('../views/audit/AuditLogView.vue'),
        meta: { title: '操作记录' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

let restoring: Promise<void> | null = null;

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (to.meta.public) {
    return true;
  }
  if (!session.loggedIn) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (!session.loaded) {
    restoring ??= session.restore().finally(() => {
      restoring = null;
    });
    try {
      await restoring;
    } catch {
      session.logout();
      return { name: 'login' };
    }
  }
  if (session.mustChangePassword && to.name !== 'change-password') {
    return { name: 'change-password' };
  }
  if (to.meta.minRole && !session.atLeast(to.meta.minRole)) {
    message.warning('当前账号没有这个页面的权限');
    return { name: 'dashboard' };
  }
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 储值会员商家后台` : '储值会员商家后台';
});

handleUnauthorized(() => {
  const session = useSessionStore();
  if (!session.loggedIn) {
    return;
  }
  session.logout();
  message.warning('登录已过期，请重新登录');
  void router.push({ name: 'login' });
});
