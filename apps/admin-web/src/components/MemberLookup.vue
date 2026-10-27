<template>
  <div class="lookup">
    <a-input-search
      v-model:value="phone"
      size="large"
      placeholder="输入会员完整手机号"
      enter-button="查找会员"
      :maxlength="13"
      :loading="loading"
      allow-clear
      @search="search"
    />
    <a-alert v-if="error" class="msg" type="error" show-icon :message="error" />
    <a-alert v-else-if="notFound" class="msg" type="info" show-icon message="没有找到这个手机号的会员">
      <template #description>
        还没开卡的话，先去开卡。
        <router-link :to="{ name: 'member-open', query: { phone: normalizePhone(phone) } }">去开卡</router-link>
      </template>
    </a-alert>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { errorMessage } from '../api/http';
import { findMemberByPhone } from '../api/members';
import type { MemberCard } from '../api/types';
import { isMobile, normalizePhone } from '../utils/phone';

const emit = defineEmits<{ found: [member: MemberCard] }>();

const phone = ref('');
const loading = ref(false);
const error = ref('');
const notFound = ref(false);

async function search(): Promise<void> {
  error.value = '';
  notFound.value = false;
  const value = normalizePhone(phone.value);
  if (!isMobile(value)) {
    error.value = '请输入 11 位手机号';
    return;
  }
  loading.value = true;
  try {
    const member = await findMemberByPhone(value);
    if (member) {
      emit('found', member);
    } else {
      notFound.value = true;
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

defineExpose({
  reset(): void {
    phone.value = '';
    error.value = '';
    notFound.value = false;
  },
});
</script>

<style scoped>
.lookup {
  max-width: 480px;
}

.msg {
  margin-top: 12px;
}
</style>
