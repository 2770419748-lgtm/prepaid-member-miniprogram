<template>
  <a-modal
    :open="open"
    :title="disabling ? '停用会员' : '恢复会员'"
    :ok-text="disabling ? '确认停用' : '确认恢复'"
    :ok-button-props="{ danger: disabling, loading, disabled: !reason.trim() }"
    cancel-text="取消"
    :mask-closable="false"
    @ok="submit"
    @cancel="emit('close')"
  >
    <template v-if="member">
      <p class="explain">
        <template v-if="disabling">
          停用后，这位会员登录不了会员小程序，手机上已有的登录马上失效；门店也不能给他充值、消费或开权益单。余额保留，需要时仍可退余额。顾客丢了手机可以先停用止损。
        </template>
        <template v-else>恢复后会员可以重新登录、正常使用余额。停用前的旧登录不会恢复，要重新登录。</template>
      </p>
      <a-descriptions :column="1" size="small" bordered class="desc">
        <a-descriptions-item label="会员">{{ member.name || '未填称呼' }} · {{ member.phone }}</a-descriptions-item>
        <a-descriptions-item label="余额">{{ formatCent(member.balanceCent ?? 0) }} 元</a-descriptions-item>
      </a-descriptions>
      <a-form layout="vertical">
        <a-form-item :label="disabling ? '停用原因' : '恢复原因'" required extra="写进操作记录">
          <a-textarea
            v-model:value="reason"
            :maxlength="200"
            show-count
            :rows="2"
            :placeholder="disabling ? '例如：顾客手机丢失，先停用' : '例如：顾客找回手机'"
          />
        </a-form-item>
      </a-form>
      <a-alert v-if="error" type="error" show-icon :message="error" />
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../api/http';
import { setMemberStatus } from '../api/members';
import type { MemberCard } from '../api/types';
import { formatCent } from '../utils/money';

const props = defineProps<{ open: boolean; member: MemberCard | null }>();
const emit = defineEmits<{ close: []; done: [member: MemberCard] }>();

const reason = ref('');
const loading = ref(false);
const error = ref('');

const disabling = computed(() => props.member?.status !== 'DISABLED');

watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = '';
      error.value = '';
    }
  },
);

async function submit(): Promise<void> {
  if (!props.member || !reason.value.trim()) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const updated = await setMemberStatus(props.member.id, disabling.value ? 'disable' : 'enable', reason.value.trim());
    message.success(disabling.value ? '已停用' : '已恢复');
    emit('done', updated);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.explain {
  color: #64748b;
}

.desc {
  margin-bottom: 16px;
}
</style>
