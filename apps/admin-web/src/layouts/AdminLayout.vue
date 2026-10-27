<template>
  <a-layout class="shell">
    <a-layout-sider class="sider" theme="light" :width="220" breakpoint="lg" collapsed-width="0">
      <div class="brand-wrap">
        <BrandMark />
      </div>
      <a-menu
        mode="inline"
        :selected-keys="selectedKeys"
        :open-keys="openKeys"
        :items="menuItems"
        @click="onMenuClick"
        @open-change="(keys: string[]) => (openKeys = keys)"
      />
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="header">
        <div class="store-picker">
          <span class="label">当前门店</span>
          <a-select
            v-if="session.stores.length > 1"
            :value="session.currentStoreId ?? undefined"
            style="min-width: 200px"
            :options="storeOptions"
            @change="onStoreChange"
          />
          <span v-else-if="session.currentStore" class="single">{{ session.currentStore.name }}</span>
          <span v-else class="single muted">未分配门店</span>
          <a-tag v-if="session.currentStore?.status === 'DISABLED'" color="warning">已停用，不能记账</a-tag>
        </div>
        <a-dropdown placement="bottomRight">
          <a class="user" @click.prevent>
            <a-avatar :size="28" class="avatar">{{ initial }}</a-avatar>
            <span>{{ session.staff?.name }}</span>
            <a-tag class="role-tag">{{ roleLabel }}</a-tag>
            <DownOutlined />
          </a>
          <template #overlay>
            <a-menu>
              <a-menu-item key="password" @click="router.push({ name: 'change-password' })">修改密码</a-menu-item>
              <a-menu-divider />
              <a-menu-item key="logout" @click="logout">退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import {
  AuditOutlined,
  DashboardOutlined,
  DownOutlined,
  FileProtectOutlined,
  IdcardOutlined,
  ShopOutlined,
  WalletOutlined,
} from '@ant-design/icons-vue';
import type { ItemType } from 'ant-design-vue';
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../components/BrandMark.vue';
import { buildMenu } from '../menu';
import { useSessionStore } from '../stores/session';
import { ROLE_LABEL } from '../utils/roles';

const router = useRouter();
const route = useRoute();
const session = useSessionStore();

const icons = {
  dashboard: DashboardOutlined,
  member: IdcardOutlined,
  billing: WalletOutlined,
  org: ShopOutlined,
  benefit: FileProtectOutlined,
  audit: AuditOutlined,
} as const;

const menu = computed(() => buildMenu((role) => session.atLeast(role), session.superAdmin));

const menuItems = computed<ItemType[]>(() =>
  menu.value.map((group) =>
    group.children
      ? {
          key: group.key,
          label: group.label,
          icon: () => h(icons[group.icon]),
          children: group.children.map((child) => ({ key: child.key, label: child.label })),
        }
      : { key: group.key, label: group.label, icon: () => h(icons[group.icon]) },
  ),
);

const openKeys = ref<string[]>(menu.value.filter((g) => g.children).map((g) => g.key));

const selectedKeys = computed(() => [String(route.meta.menuKey ?? route.name ?? '')]);

watch(
  () => session.superAdmin,
  () => {
    openKeys.value = menu.value.filter((g) => g.children).map((g) => g.key);
  },
);

const storeOptions = computed(() =>
  session.stores.map((store) => ({
    value: store.id,
    label: store.status === 'DISABLED' ? `${store.name}（已停用）` : store.name,
  })),
);

const roleLabel = computed(() => {
  if (session.superAdmin) {
    return ROLE_LABEL.SUPER_ADMIN;
  }
  const here = session.currentStore?.role ?? session.topRole;
  return here ? ROLE_LABEL[here] : '';
});

const initial = computed(() => session.staff?.name.slice(0, 1) ?? '');

function onMenuClick({ key }: { key: string | number }): void {
  void router.push({ name: String(key) });
}

function onStoreChange(value: unknown): void {
  session.setCurrentStore(String(value));
}

function logout(): void {
  session.logout();
  void router.push({ name: 'login' });
}
</script>

<style scoped>
.shell {
  min-height: 100vh;
}

.sider {
  border-right: 1px solid #e2e8f0;
}

.sider :deep(.ant-menu-light.ant-menu-root.ant-menu-inline) {
  border-inline-end: none;
}

.brand-wrap {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #e2e8f0;
}

.header {
  background: #fff;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid #e2e8f0;
  line-height: normal;
}

.store-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}

.store-picker .label {
  color: #64748b;
}

.store-picker .single {
  font-weight: 500;
}

.muted {
  color: #64748b;
}

.user {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #0f172a;
}

.avatar {
  background: #1677ff;
}

.role-tag {
  margin: 0;
}

.content {
  padding: 24px;
  min-width: 0;
}
</style>
