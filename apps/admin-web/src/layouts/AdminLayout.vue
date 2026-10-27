<template>
  <a-layout class="shell">
    <a-layout-sider theme="light" width="220">
      <div class="brand">储值会员</div>
      <a-menu mode="inline" :selected-keys="['dashboard']">
        <a-menu-item key="dashboard">概览</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="header">
        <span>商家后台</span>
        <a-button type="link" @click="goLogin">退出（占位）</a-button>
      </a-layout-header>
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goLogin(): void {
  void router.push({ name: 'login' });
}
</script>

<style scoped>
.shell {
  min-height: 100vh;
}

.brand {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  font-weight: 600;
  font-size: 16px;
}

.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid #f0f0f0;
}

.content {
  margin: 24px;
}
</style>
