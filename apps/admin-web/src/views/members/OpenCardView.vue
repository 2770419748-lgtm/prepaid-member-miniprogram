<template>
  <div class="page">
    <h1 class="pm-page-title">开卡</h1>
    <p class="pm-page-sub">登记会员手机号，开一张余额为 0 的储值卡。一个手机号只能开一张卡，全公司门店通用。</p>

    <a-card v-if="created" :bordered="false" class="block">
      <a-result status="success" title="开卡成功">
        <template #subTitle>
          {{ created.name || '未填称呼' }} · {{ created.phone }} · {{ created.openStoreName }}
          <div>会员用这个手机号登录小程序，就能看到余额和明细。</div>
        </template>
        <template #extra>
          <a-button type="primary" @click="router.push({ name: 'recharge', query: { memberId: created.id } })">
            去充值
          </a-button>
          <a-button @click="router.push({ name: 'member-detail', params: { id: created.id } })">查看会员</a-button>
          <a-button @click="reset">继续开卡</a-button>
        </template>
      </a-result>
    </a-card>

    <a-card v-else :bordered="false" class="block">
      <a-form ref="formRef" layout="vertical" :model="form" class="form" @finish="openConfirm">
        <a-form-item
          label="会员手机号"
          name="phone"
          :rules="[
            { required: true, message: '请输入手机号' },
            { validator: checkPhone, trigger: 'blur' },
          ]"
        >
          <a-input v-model:value="form.phone" size="large" placeholder="11 位手机号" :maxlength="13" />
        </a-form-item>
        <a-form-item label="称呼" name="name" extra="可不填，例如：王女士">
          <a-input v-model:value="form.name" :maxlength="40" placeholder="会员称呼" />
        </a-form-item>
        <a-form-item label="开卡门店" name="storeId" :rules="[{ required: true, message: '请选择门店' }]">
          <a-select v-model:value="form.storeId" :options="storeOptions" placeholder="选择门店" />
        </a-form-item>
        <a-alert v-if="error" class="gap" type="error" show-icon :message="error">
          <template v-if="existing" #description>
            <router-link :to="{ name: 'member-detail', params: { id: existing.id } }">查看这位会员</router-link>
            ，或直接
            <router-link :to="{ name: 'recharge', query: { memberId: existing.id } }">给他充值</router-link>
          </template>
        </a-alert>
        <a-button type="primary" size="large" html-type="submit">开卡</a-button>
      </a-form>
    </a-card>

    <a-modal
      :open="confirmOpen"
      title="确认开卡"
      ok-text="确认开卡"
      cancel-text="再看看"
      :ok-button-props="{ loading }"
      @ok="submit"
      @cancel="confirmOpen = false"
    >
      <a-descriptions :column="1" size="small" bordered>
        <a-descriptions-item label="手机号">{{ normalizePhone(form.phone) }}</a-descriptions-item>
        <a-descriptions-item label="称呼">{{ form.name.trim() || '未填' }}</a-descriptions-item>
        <a-descriptions-item label="开卡门店">{{ storeName }}</a-descriptions-item>
        <a-descriptions-item label="初始余额">0.00 元</a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage, errorStatus } from '../../api/http';
import { findMemberByPhone, openCard } from '../../api/members';
import type { MemberCard } from '../../api/types';
import { useSessionStore } from '../../stores/session';
import { isMobile, normalizePhone } from '../../utils/phone';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

function initialStore(): string | undefined {
  const current = session.currentStore;
  return current && current.status === 'ACTIVE' ? current.id : session.activeStores[0]?.id;
}

const form = reactive({
  phone: typeof route.query.phone === 'string' ? route.query.phone : '',
  name: '',
  storeId: initialStore(),
});
const confirmOpen = ref(false);
const loading = ref(false);
const error = ref('');
const existing = ref<MemberCard | null>(null);
const created = ref<MemberCard | null>(null);

const storeOptions = computed(() => session.activeStores.map((s) => ({ value: s.id, label: s.name })));
const storeName = computed(() => session.stores.find((s) => s.id === form.storeId)?.name ?? '');

async function checkPhone(_rule: unknown, value: string): Promise<void> {
  if (value && !isMobile(value)) {
    throw new Error('请输入 11 位手机号');
  }
}

function openConfirm(): void {
  error.value = '';
  existing.value = null;
  confirmOpen.value = true;
}

async function submit(): Promise<void> {
  if (!form.storeId) {
    return;
  }
  loading.value = true;
  const phone = normalizePhone(form.phone);
  try {
    created.value = await openCard({ phone, name: form.name.trim() || undefined, storeId: form.storeId });
    confirmOpen.value = false;
  } catch (e) {
    confirmOpen.value = false;
    error.value = errorMessage(e);
    if (errorStatus(e) === 409) {
      existing.value = await findMemberByPhone(phone).catch(() => null);
    }
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  created.value = null;
  form.phone = '';
  form.name = '';
  form.storeId = initialStore();
}
</script>

<style scoped>
.page {
  max-width: 720px;
}

.block {
  border-radius: 12px;
}

.form {
  max-width: 420px;
}

.gap {
  margin-bottom: 16px;
}
</style>
