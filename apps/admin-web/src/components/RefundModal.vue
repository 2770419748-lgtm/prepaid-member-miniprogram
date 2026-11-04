<template>
  <a-modal
    :open="open"
    title="退余额"
    ok-text="确认退款"
    :ok-button-props="{ danger: true, loading, disabled: !ready }"
    cancel-text="取消"
    :mask-closable="false"
    @ok="submit"
    @cancel="emit('close')"
  >
    <template v-if="member">
      <p class="explain">
        把会员没用完的储值退给顾客。这里只记账，钱请在门店线下退（现金、转账等）。退完余额减少，记错了可以冲正。
      </p>
      <a-descriptions :column="1" size="small" bordered class="desc">
        <a-descriptions-item label="会员">{{ member.name || '未填称呼' }} · {{ member.phone }}</a-descriptions-item>
        <a-descriptions-item label="当前余额">{{ formatCent(balance) }} 元</a-descriptions-item>
      </a-descriptions>
      <a-form layout="vertical">
        <a-form-item label="办理门店" required :extra="stores.length === 0 ? '你没有可以办理退款的门店（要店长或超级管理员）' : undefined">
          <a-select v-model:value="storeId" :options="stores" placeholder="选择门店" />
        </a-form-item>
        <a-form-item
          label="退款金额"
          required
          :validate-status="amountTouched && amountMsg ? 'error' : ''"
          :help="amountTouched ? amountMsg : undefined"
        >
          <div class="amount-row">
            <a-input
              v-model:value="amount"
              prefix="¥"
              suffix="元"
              placeholder="0.00"
              inputmode="decimal"
              class="amount-input"
              @blur="amountTouched = true"
            />
            <a-button @click="fillAll">全部退</a-button>
          </div>
        </a-form-item>
        <a-form-item label="退款原因和方式" required extra="写进流水和操作记录，会员看不到">
          <a-textarea
            v-model:value="remark"
            :maxlength="200"
            show-count
            :rows="2"
            placeholder="例如：顾客搬家不再来，现金退回"
          />
        </a-form-item>
      </a-form>
      <a-alert
        v-if="amountCent && !amountMsg"
        type="warning"
        show-icon
        :message="`退 ${formatCent(amountCent)} 元，退完余额 ${formatCent(balance - amountCent)} 元`"
        description="请确认已把这笔钱退给顾客。"
      />
      <a-alert v-if="error" class="gap" type="error" show-icon :message="error" />
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, ref, watch } from 'vue';
import { errorMessage, isNetworkError } from '../api/http';
import { refund } from '../api/ledger';
import type { MemberCard, MoneyMoveResult } from '../api/types';
import { useSessionStore } from '../stores/session';
import { amountError, formatCent, yuanToCent } from '../utils/money';
import { canRefundAt } from '../utils/roles';
import { newRequestId } from '../utils/request-id';

const props = defineProps<{ open: boolean; member: MemberCard | null }>();
const emit = defineEmits<{ close: []; done: [result: MoneyMoveResult] }>();

const session = useSessionStore();
const storeId = ref<string | undefined>(undefined);
const amount = ref('');
const amountTouched = ref(false);
const remark = ref('');
const loading = ref(false);
const error = ref('');
// 每次打开弹窗一个请求号：断网后再点「确认退款」不会记两笔；第一次其实已记上时，改了金额再交会被拒，也不会多退。
let requestId = newRequestId();

const balance = computed(() => props.member?.balanceCent ?? 0);

/** 能办理退款的门店：在营，并且自己是超级管理员或这家店的店长。 */
const stores = computed(() =>
  session.activeStores
    .filter((store) => canRefundAt(session.roles, store.id))
    .map((store) => ({ value: store.id, label: store.name })),
);

const amountCent = computed(() => yuanToCent(amount.value));
const amountMsg = computed(() => {
  const basic = amountError(amount.value);
  if (basic) {
    return basic;
  }
  return (amountCent.value ?? 0) > balance.value ? '不能超过当前余额' : null;
});
const ready = computed(() => !!storeId.value && !amountMsg.value && !!remark.value.trim());

function fillAll(): void {
  amount.value = formatCent(balance.value).replace(/,/g, '');
  amountTouched.value = true;
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      const current = session.currentStoreId;
      storeId.value = stores.value.find((store) => store.value === current)?.value ?? stores.value[0]?.value;
      amount.value = '';
      amountTouched.value = false;
      remark.value = '';
      error.value = '';
      requestId = newRequestId();
    }
  },
);

async function submit(): Promise<void> {
  if (!props.member || !ready.value || !storeId.value || !amountCent.value) {
    amountTouched.value = true;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await refund(props.member.id, {
      storeId: storeId.value,
      amountCent: amountCent.value,
      remark: remark.value.trim(),
      requestId,
    });
    message.success(result.replayed ? '这笔已经退过了，没有重复记账' : '已记退款');
    emit('done', result);
  } catch (e) {
    error.value = isNetworkError(e)
      ? '网络不稳定，没收到结果。再点一次「确认退款」不会重复记账。'
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

.amount-row {
  display: flex;
  gap: 8px;
}

.amount-input {
  max-width: 240px;
}

.gap {
  margin-top: 12px;
}
</style>
