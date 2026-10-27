<template>
  <a-config-provider :locale="zhCN" :theme="theme" :auto-insert-space-in-button="false">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { theme } from './theme';
</script>
