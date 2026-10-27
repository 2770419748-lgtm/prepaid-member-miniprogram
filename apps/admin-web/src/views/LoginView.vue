<template>
  <div class="login">
    <a-card title="储值会员 · 商家登录" class="card">
      <a-form layout="vertical">
        <a-form-item label="手机号">
          <a-input placeholder="登录将在后续里程碑开放" disabled />
        </a-form-item>
        <a-form-item label="密码">
          <a-input-password placeholder="占位" disabled />
        </a-form-item>
        <a-space>
          <a-button type="primary" disabled>登录</a-button>
          <a-button @click="enterShell">进入后台壳</a-button>
        </a-space>
      </a-form>
      <a-typography-paragraph type="secondary" class="note">
        当前为界面壳。账号、门店与权限尚未接入。
      </a-typography-paragraph>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function enterShell(): void {
  void router.push({ name: 'dashboard' });
}
</script>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.card {
  width: 400px;
}

.note {
  margin-top: 16px;
  margin-bottom: 0;
}
</style>
