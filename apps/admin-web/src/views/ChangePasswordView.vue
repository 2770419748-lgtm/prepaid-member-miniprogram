<template>
  <div class="wrap">
    <div class="panel">
      <BrandMark class="brand" />
      <h1 class="title">{{ forced ? '先改一个自己的密码' : '修改密码' }}</h1>
      <p class="hint">
        <template v-if="forced">这是第一次登录，或密码刚被重置。为了账号安全，请把初始密码换成只有你知道的密码。</template>
        <template v-else>修改后请用新密码登录。</template>
      </p>
      <a-alert v-if="error" class="error" type="error" show-icon :message="error" />
      <a-form ref="formRef" layout="vertical" :model="form" @finish="submit">
        <a-form-item
          :label="forced ? '初始密码' : '当前密码'"
          name="currentPassword"
          :rules="[{ required: true, message: '请输入当前密码' }]"
        >
          <a-input-password v-model:value="form.currentPassword" size="large" autocomplete="current-password" />
        </a-form-item>
        <a-form-item label="新密码" name="newPassword" :rules="newRules" extra="8 到 64 位，不能和当前密码一样">
          <a-input-password v-model:value="form.newPassword" size="large" autocomplete="new-password" />
        </a-form-item>
        <a-form-item label="再输一次新密码" name="confirm" :rules="confirmRules">
          <a-input-password v-model:value="form.confirm" size="large" autocomplete="new-password" />
        </a-form-item>
        <a-button type="primary" html-type="submit" size="large" block :loading="loading">确认修改</a-button>
      </a-form>
      <div class="actions">
        <a-button v-if="!forced" type="link" @click="router.back()">返回</a-button>
        <a-button v-else type="link" @click="logout">退出登录</a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { changePassword } from '../api/auth';
import { errorMessage } from '../api/http';
import BrandMark from '../components/BrandMark.vue';
import { useSessionStore } from '../stores/session';

const router = useRouter();
const session = useSessionStore();
const forced = computed(() => session.mustChangePassword);

const form = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const loading = ref(false);
const error = ref('');

const newRules: Rule[] = [
  { required: true, message: '请输入新密码' },
  { min: 8, max: 64, message: '新密码要 8 到 64 位' },
  {
    validator: async (_rule, value: string) => {
      if (value && value === form.currentPassword) {
        throw new Error('新密码不能和当前密码一样');
      }
    },
  },
];

const confirmRules: Rule[] = [
  { required: true, message: '请再输一次新密码' },
  {
    validator: async (_rule, value: string) => {
      if (value && value !== form.newPassword) {
        throw new Error('两次输入的新密码不一样');
      }
    },
  },
];

async function submit(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    await changePassword(form.currentPassword, form.newPassword);
    session.passwordChanged();
    message.success('密码已修改');
    await router.replace({ name: 'dashboard' });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

function logout(): void {
  session.logout();
  void router.push({ name: 'login' });
}
</script>

<style scoped>
.wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #f8fafc;
}

.panel {
  width: 100%;
  max-width: 420px;
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

.actions {
  margin-top: 8px;
  text-align: center;
}
</style>
