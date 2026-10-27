<template>
  <div class="login">
    <div class="panel">
      <BrandMark large class="brand" />
      <h1 class="title">员工登录</h1>
      <p class="hint">账号由店长或超级管理员开通</p>
      <a-alert v-if="error" class="error" :type="locked ? 'warning' : 'error'" show-icon :message="error">
        <template v-if="!locked" #description>连续输错 5 次，账号会锁定 15 分钟。</template>
      </a-alert>
      <a-form layout="vertical" :model="form" @finish="submit">
        <a-form-item
          label="手机号"
          name="phone"
          :rules="[
            { required: true, message: '请输入手机号' },
            { validator: checkPhone, trigger: 'blur' },
          ]"
        >
          <a-input v-model:value="form.phone" size="large" placeholder="11 位手机号" :maxlength="13" autocomplete="username" />
        </a-form-item>
        <a-form-item label="密码" name="password" :rules="[{ required: true, message: '请输入密码' }]">
          <a-input-password v-model:value="form.password" size="large" placeholder="密码" autocomplete="current-password" />
        </a-form-item>
        <a-button type="primary" html-type="submit" size="large" block :loading="loading">登录</a-button>
      </a-form>
      <p class="foot">忘记密码请联系超级管理员重置。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../api/http';
import BrandMark from '../components/BrandMark.vue';
import { useSessionStore } from '../stores/session';
import { isMobile, normalizePhone } from '../utils/phone';

const router = useRouter();
const route = useRoute();
const session = useSessionStore();

const form = reactive({ phone: '', password: '' });
const loading = ref(false);
const error = ref('');
const locked = ref(false);

async function checkPhone(_rule: unknown, value: string): Promise<void> {
  if (value && !isMobile(value)) {
    throw new Error('请输入 11 位手机号');
  }
}

async function submit(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    await session.login(normalizePhone(form.phone), form.password);
    if (session.mustChangePassword) {
      await router.replace({ name: 'change-password' });
      return;
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    await router.replace(redirect);
  } catch (e) {
    const text = errorMessage(e, '登录没有成功，请稍后再试');
    locked.value = text.includes('锁定');
    error.value = locked.value ? '连续输错 5 次，账号已锁定。请 15 分钟后再试，或联系超级管理员。' : text;
    form.password = '';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #f8fafc;
}

.panel {
  width: 100%;
  max-width: 400px;
  padding: 32px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.brand {
  margin-bottom: 24px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.hint {
  margin: 4px 0 24px;
  color: #64748b;
}

.error {
  margin-bottom: 16px;
}

.foot {
  margin: 16px 0 0;
  color: #64748b;
  font-size: 12px;
  text-align: center;
}
</style>
