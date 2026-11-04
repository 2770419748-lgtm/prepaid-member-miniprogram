<template>
  <a-modal
    :open="open"
    title="修改会员资料"
    ok-text="保存"
    :ok-button-props="{ loading, disabled: !ready }"
    cancel-text="取消"
    :mask-closable="false"
    @ok="submit"
    @cancel="emit('close')"
  >
    <template v-if="member">
      <a-form layout="vertical">
        <a-form-item label="称呼">
          <a-input v-model:value="name" :maxlength="40" placeholder="例如：王女士（可不填）" />
        </a-form-item>
        <a-form-item
          label="手机号"
          required
          :validate-status="phoneMsg ? 'error' : ''"
          :help="phoneMsg || undefined"
        >
          <a-input v-model:value="phone" :maxlength="20" inputmode="tel" />
        </a-form-item>
        <template v-if="phoneChanged">
          <a-alert
            class="gap"
            type="warning"
            show-icon
            message="换手机号以后"
            description="顾客要用新手机号重新登录小程序，旧手机上的登录马上失效。余额、流水和权益单都跟着会员走，不受影响。请先核对是本人。"
          />
          <a-form-item label="换号原因" required extra="写进操作记录">
            <a-textarea
              v-model:value="reason"
              :maxlength="200"
              show-count
              :rows="2"
              placeholder="例如：顾客手机丢了，本人到店出示身份证核对"
            />
          </a-form-item>
        </template>
      </a-form>
      <a-alert v-if="error" type="error" show-icon :message="error" />
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/http';
import { updateMember } from '../api/members';
import type { MemberCard } from '../api/types';
import { isMobile, normalizePhone } from '../utils/phone';

const props = defineProps<{ open: boolean; member: MemberCard | null }>();
const emit = defineEmits<{ close: []; done: [member: MemberCard] }>();

const name = ref('');
const phone = ref('');
const reason = ref('');
const loading = ref(false);
const error = ref('');

const phoneChanged = computed(() => !!props.member && normalizePhone(phone.value) !== props.member.phone);
const nameChanged = computed(() => !!props.member && name.value.trim() !== (props.member.name ?? ''));
const phoneMsg = computed(() => (phone.value.trim() && !isMobile(phone.value) ? '请输入 11 位手机号' : ''));
const ready = computed(
  () =>
    !!phone.value.trim() &&
    !phoneMsg.value &&
    (phoneChanged.value || nameChanged.value) &&
    (!phoneChanged.value || !!reason.value.trim()),
);

watch(
  () => props.open,
  (open) => {
    if (open && props.member) {
      name.value = props.member.name ?? '';
      phone.value = props.member.phone;
      reason.value = '';
      error.value = '';
    }
  },
);

async function submit(): Promise<void> {
  if (!props.member || !ready.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const updated = await updateMember(props.member.id, {
      ...(nameChanged.value ? { name: name.value.trim() } : {}),
      ...(phoneChanged.value ? { phone: normalizePhone(phone.value), reason: reason.value.trim() } : {}),
    });
    message.success(phoneChanged.value ? '已换手机号，会员要用新号重新登录' : '已保存');
    emit('done', updated);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.gap {
  margin-bottom: 16px;
}
</style>
