import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { fetchMe, fetchMyStores, loginWithPassword } from '../api/auth';
import { getToken, setToken } from '../api/http';
import type { MyStore, RoleView, StaffRole, StaffSummary } from '../api/types';
import { canManageStore, hasRoleAtLeast, highestRole, isSuperAdmin, managedStoreIds } from '../utils/roles';

const STORE_KEY = 'pm-admin-store';

function readCurrentStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function writeCurrentStore(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(STORE_KEY, id);
    } else {
      localStorage.removeItem(STORE_KEY);
    }
  } catch {
    // 本地存储不可用时只记在内存里。
  }
}

/** 当前登录的员工、角色和「当前门店」。记账、开卡默认记在当前门店。 */
export const useSessionStore = defineStore('session', () => {
  const token = ref<string | null>(getToken());
  const staff = ref<StaffSummary | null>(null);
  const roles = ref<RoleView[]>([]);
  const mustChangePassword = ref(false);
  const stores = ref<MyStore[]>([]);
  const currentStoreId = ref<string | null>(readCurrentStore());
  const loaded = ref(false);

  const loggedIn = computed(() => token.value !== null);
  const superAdmin = computed(() => isSuperAdmin(roles.value));
  const topRole = computed<StaffRole | null>(() => highestRole(roles.value));
  const managed = computed(() => managedStoreIds(roles.value));
  const currentStore = computed(() => stores.value.find((s) => s.id === currentStoreId.value) ?? null);
  /** 能记账的门店：自己有权限且在营业。 */
  const activeStores = computed(() => stores.value.filter((s) => s.status === 'ACTIVE'));

  function atLeast(role: StaffRole): boolean {
    return hasRoleAtLeast(roles.value, role);
  }

  function canManage(storeId: string): boolean {
    return canManageStore(roles.value, storeId);
  }

  function pickStore(): void {
    const valid = stores.value.find((s) => s.id === currentStoreId.value);
    if (!valid) {
      const fallback = activeStores.value[0] ?? stores.value[0] ?? null;
      setCurrentStore(fallback?.id ?? null);
    }
  }

  function setCurrentStore(id: string | null): void {
    currentStoreId.value = id;
    writeCurrentStore(id);
  }

  async function refreshStores(): Promise<void> {
    const result = await fetchMyStores();
    stores.value = result.stores;
    pickStore();
  }

  async function login(phone: string, password: string): Promise<void> {
    const result = await loginWithPassword(phone, password);
    setToken(result.accessToken);
    token.value = result.accessToken;
    staff.value = result.staff;
    roles.value = result.roles;
    mustChangePassword.value = result.mustChangePassword;
    // 没改初始密码前服务端只放行改密码、看本人信息，门店列表要等改完重新登录再取。
    if (!result.mustChangePassword) {
      await refreshStores();
    }
    loaded.value = true;
  }

  /** 刷新页面后，用保存的登录凭证恢复会话。 */
  async function restore(): Promise<void> {
    const me = await fetchMe();
    staff.value = me.staff;
    roles.value = me.roles;
    mustChangePassword.value = me.staff.mustChangePassword;
    if (!me.staff.mustChangePassword) {
      await refreshStores();
    }
    loaded.value = true;
  }

  /** 接口说要先改初始密码（例如密码刚被超级管理员重置）。 */
  function requirePasswordChange(): void {
    mustChangePassword.value = true;
  }

  function logout(): void {
    setToken(null);
    token.value = null;
    staff.value = null;
    roles.value = [];
    stores.value = [];
    mustChangePassword.value = false;
    loaded.value = false;
  }

  return {
    token,
    staff,
    roles,
    mustChangePassword,
    stores,
    currentStoreId,
    loaded,
    loggedIn,
    superAdmin,
    topRole,
    managed,
    currentStore,
    activeStores,
    atLeast,
    canManage,
    setCurrentStore,
    refreshStores,
    login,
    restore,
    requirePasswordChange,
    logout,
  };
});
