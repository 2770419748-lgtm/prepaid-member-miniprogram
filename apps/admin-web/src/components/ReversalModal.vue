<template>
  <a-modal
    :open="open"
    title="记错了账，补记一笔抵掉"
    ok-text="确认冲正"
    :ok-button-props="{ danger: true, loading, disabled: !remark.trim() }"
    cancel-text="取消"
    :mask-closable="false"
    @ok="submit"
    @cancel="emit('close')"
  >
    <template v-if="entry">
      <p class="explain">
        系统会补记一笔方向相反、金额相同的流水，把这笔整笔抵掉。原记录保留，标为「已冲正」。一笔只能冲一次，冲完不能撤回。
      </p>
      <a-descriptions :column="1" size="small" bordered class="desc">
        <a-descriptions-item label="会员">{{ entry.memberName || '未填称呼' }} · {{ maskPhone(entry.memberPhone) }}</a-descriptions-item>
        <a-descriptions-item label="原流水">
          <LedgerTypeTag :type="entry.type" />
          <MoneyText :cent="entry.changeCent" signed class="amount" />
          <span class="muted">{{ entry.storeName }} · {{ formatDateTime(entry.createdAt) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="冲正后余额变动">
          <MoneyText :cent="-entry.changeCent" signed />
        </a-descriptions-item>
      </a-descriptions>
      <a-form layout="vertical">
        <a-form-item label="冲正原因" required>
          <a-textarea v-model:value="remark" :maxlength="200" show-count :rows="2" placeholder="例如：金额录错，应为 100 元" />
        </a-form-item>
      </a-form>
      <a-alert v-if="error" type="error" show-icon :message="error" />
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { ref, watch } from 'vue';
import { errorMessage, isNetworkError } from '../api/http';
import { reverse } from '../api/ledger';
import type { LedgerEntry, MoneyMoveResult } from '../api/types';
import { formatDateTime } from '../utils/datetime';
import { maskPhone } from '../utils/phone';
import { newRequestId } from '../utils/request-id';
import LedgerTypeTag from './LedgerTypeTag.vue';
import MoneyText from './MoneyText.vue';

const props = defineProps<{ open: boolean; entry: LedgerEntry | null }>();
const emit = defineEmits<{ close: []; done: [result: MoneyMoveResult] }>();

const remark = ref('');
const loading = ref(false);
const error = ref('');
let requestId = newRequestId();

watch(
  () => props.open,
  (open) => {
    if (open) {
      remark.value = '';
      error.value = '';
      requestId = newRequestId();
    }
  },
);

async function submit(): Promise<void> {
  if (!props.entry || !remark.value.trim()) {
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await reverse(props.entry.id, { remark: remark.value.trim(), requestId });
    message.success(result.replayed ? '这笔已经冲正过了，没有重复记账' : '已冲正');
    emit('done', result);
  } catch (e) {
    error.value = isNetworkError(e)
      ? '网络不稳定，没收到结果。再点一次「确认冲正」不会重复记账。'
      : errorMessage(e);
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

.amount {
  margin: 0 8px;
  font-weight: 500;
}

.muted {
  color: #64748b;
}
</style>
