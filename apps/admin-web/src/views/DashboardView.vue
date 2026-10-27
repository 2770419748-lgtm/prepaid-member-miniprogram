<template>
  <div>
    <a-page-header title="概览" sub-title="储值会员 · 线下记账与线上权益" />
    <a-row :gutter="16">
      <a-col :span="8">
        <a-card title="服务状态" :loading="loading">
          <template v-if="health">
            <p>接口：{{ health.ok ? '可用' : '异常' }}</p>
            <p>数据库：{{ health.db === 'up' ? '已连接' : '未连接' }}</p>
            <p>正式签署：{{ health.esignProductionEnabled ? '已打开' : '关闭（默认）' }}</p>
          </template>
          <a-alert v-else-if="error" type="warning" :message="error" show-icon />
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card title="会员与门店">
          <p>余额全公司通用，不按门店拆分。</p>
          <p>充值与消费仅线下记账展示。</p>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card title="会员权益">
          <p>权益方案与电子签将在后续里程碑接入。</p>
          <p>默认只允许沙箱，不走正式签署。</p>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, type HealthResponse } from '../api/http';

const loading = ref(true);
const health = ref<HealthResponse | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    const { data } = await http.get<HealthResponse>('/health');
    health.value = data;
  } catch {
    error.value = '暂时无法连接接口。请确认 API 已在本地启动。';
  } finally {
    loading.value = false;
  }
});
</script>
