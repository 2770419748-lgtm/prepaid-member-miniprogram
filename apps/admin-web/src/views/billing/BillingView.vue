<template>
  <div class="page">
    <h1 class="pm-page-title">{{ copy.title }}</h1>
    <p class="pm-page-sub">{{ copy.sub }}</p>

    <a-card v-if="result" :bordered="false" class="block">
      <a-result status="success" :title="resultTitle">
        <template #subTitle>
          {{ result.entry.memberName || '未填称呼' }} · {{ maskPhone(result.entry.memberPhone) }} · {{ result.entry.storeName }}
          <div class="result-balance">
            当前余额 <span class="num">{{ formatCent(result.balanceCent) }}</span> 元
          </div>
        </template>
        <template #extra>
          <a-button type="primary" @click="again">给这位会员再记一笔</a-button>
          <a-button @click="restart">换个会员</a-button>
          <a-button @click="router.push({ name: 'member-detail', params: { id: result.entry.memberId } })">
            查看会员流水
          </a-button>
        </template>
      </a-result>
    </a-card>

    <template v-else>
      <a-card :bordered="false" class="block" title="1. 找到会员">
        <template v-if="member">
          <MemberCardPanel :member="member" full-phone>
            <a-button size="small" @click="clearMember">换个会员</a-button>
          </MemberCardPanel>
          <a-alert v-if="memberBlock" class="gap" type="warning" show-icon :message="memberBlock" />
        </template>
        <MemberLookup v-else ref="lookupRef" @found="onFound" />
        <a-skeleton v-if="loadingMember" active :paragraph="{ rows: 2 }" />
      </a-card>

      <a-card :bordered="false" class="block" :title="`2. ${copy.amountStep}`">
        <a-form layout="vertical" class="form" :disabled="!member || !!memberBlock">
          <a-form-item label="门店" required :extra="storeHint">
            <a-select
              v-model:value="storeId"
              :options="storeOptions"
              placeholder="选择门店"
              style="max-width: 320px"
            />
          </a-form-item>
          <a-form-item label="金额" required :validate-status="amountTouched && amountMsg ? 'error' : ''" :help="amountTouched ? amountMsg : undefined">
            <a-input
              v-model:value="amount"
              size="large"
              prefix="¥"
              suffix="元"
              placeholder="0.00"
              style="max-width: 320px"
              inputmode="decimal"
              @blur="amountTouched = true"
            />
          </a-form-item>
          <a-form-item label="备注" extra="只在店内可见，会员看不到">
            <a-input v-model:value="remark" :maxlength="200" :placeholder="copy.remarkHint" style="max-width: 480px" />
          </a-form-item>
          <a-button type="primary" size="large" :danger="kind === 'CONSUME'" @click="openConfirm">
            {{ copy.button }}
          </a-button>
        </a-form>
      </a-card>
    </template>

    <a-modal
      :open="confirmOpen"
      :title="copy.confirmTitle"
      :ok-text="copy.confirmOk"
      cancel-text="再看看"
      :ok-button-props="{ loading: submitting, danger: kind === 'CONSUME' }"
      :mask-closable="false"
      @ok="submit"
      @cancel="confirmOpen = false"
    >
      <template v-if="member && amountCent">
        <div class="confirm-amount" :class="kind === 'RECHARGE' ? 'pm-amount-plus' : 'pm-amount-minus'">
          {{ kind === 'RECHARGE' ? '+' : '-' }}{{ formatCent(amountCent) }} <span class="unit">元</span>
        </div>
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="会员">{{ member.name || '未填称呼' }} · {{ member.phone }}</a-descriptions-item>
          <a-descriptions-item label="门店">{{ storeName }}</a-descriptions-item>
          <a-descriptions-item label="记账后余额">{{ formatCent(projected) }} 元</a-descriptions-item>
          <a-descriptions-item v-if="remark.trim()" label="备注">{{ remark.trim() }}</a-descriptions-item>
        </a-descriptions>
        <a-alert
          v-if="kind === 'RECHARGE'"
          class="gap"
          type="info"
          show-icon
          message="这里只记账，不收钱。请确认已在门店线下收到款。"
        />
        <a-alert v-if="largeAmount" class="gap" type="warning" show-icon message="金额较大，请再核对一次。" />
        <a-alert v-if="submitError" class="gap" type="error" show-icon :message="submitError" />
      </template>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage, isNetworkError } from '../../api/http';
import { consume, recharge } from '../../api/ledger';
import { getMember } from '../../api/members';
import type { MemberCard, MoneyMoveResult } from '../../api/types';
import MemberCardPanel from '../../components/MemberCardPanel.vue';
import MemberLookup from '../../components/MemberLookup.vue';
import { useSessionStore } from '../../stores/session';
import { amountError, formatCent, yuanToCent } from '../../utils/money';
import { maskPhone } from '../../utils/phone';
import { newRequestId } from '../../utils/request-id';

const props = defineProps<{ kind: 'RECHARGE' | 'CONSUME' }>();

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const COPY = {
  RECHARGE: {
    title: '充值记账',
    sub: '会员在门店线下付款后，在这里记一笔充值。系统不收款，只记账。',
    amountStep: '填写充值金额',
    remarkHint: '例如：现金、刷卡、转账',
    button: '充值',
    confirmTitle: '确认充值',
    confirmOk: '确认充值',
    done: '充值成功',
  },
  CONSUME: {
    title: '消费扣款',
    sub: '会员在门店消费后，从余额里扣掉。余额全公司门店通用。',
    amountStep: '填写消费金额',
    remarkHint: '例如：消费项目',
    button: '扣款',
    confirmTitle: '确认扣款',
    confirmOk: '确认扣款',
    done: '扣款成功',
  },
} as const;

const copy = computed(() => COPY[props.kind]);

const lookupRef = ref<InstanceType<typeof MemberLookup> | null>(null);
const member = ref<MemberCard | null>(null);
const loadingMember = ref(false);
const amount = ref('');
const amountTouched = ref(false);
const remark = ref('');
const storeId = ref<string | undefined>(undefined);
const confirmOpen = ref(false);
const submitting = ref(false);
const submitError = ref('');
const result = ref<MoneyMoveResult | null>(null);
let requestId = newRequestId();

const storeOptions = computed(() =>
  session.activeStores.map((store) => ({ value: store.id, label: store.name })),
);

const storeName = computed(() => session.stores.find((s) => s.id === storeId.value)?.name ?? '');
const storeHint = computed(() =>
  session.activeStores.length === 0 ? '你没有在营业的门店，不能记账' : '默认是顶部选中的当前门店',
);

const amountCent = computed(() => yuanToCent(amount.value));
const amountMsg = computed(() => {
  const base = amountError(amount.value);
  if (base) {
    return base;
  }
  if (props.kind === 'CONSUME' && member.value && amountCent.value !== null) {
    if (amountCent.value > (member.value.balanceCent ?? 0)) {
      return `余额不足，最多能扣 ${formatCent(member.value.balanceCent ?? 0)} 元`;
    }
  }
  return null;
});

const projected = computed(() => {
  const base = member.value?.balanceCent ?? 0;
  const delta = amountCent.value ?? 0;
  return props.kind === 'RECHARGE' ? base + delta : base - delta;
});

const largeAmount = computed(() => (amountCent.value ?? 0) >= 1_000_000);

const memberBlock = computed(() => {
  if (!member.value) {
    return '';
  }
  if (member.value.status === 'DISABLED') {
    return '这位会员已停用，不能记账';
  }
  if (!member.value.hasCard) {
    return '这位会员还没开卡，请先开卡';
  }
  return '';
});

const resultTitle = computed(() => {
  if (!result.value) {
    return '';
  }
  if (result.value.replayed) {
    return '这笔已经记过了，没有重复记账';
  }
  return `${copy.value.done}：${props.kind === 'RECHARGE' ? '+' : '-'}${formatCent(result.value.entry.amountCent)} 元`;
});

function defaultStore(): void {
  const current = session.currentStore;
  storeId.value = current && current.status === 'ACTIVE' ? current.id : session.activeStores[0]?.id;
}

function onFound(found: MemberCard): void {
  member.value = found;
}

function clearMember(): void {
  member.value = null;
  void router.replace({ query: {} });
}

async function loadMember(id: string): Promise<void> {
  loadingMember.value = true;
  try {
    member.value = await getMember(id);
  } catch {
    member.value = null;
  } finally {
    loadingMember.value = false;
  }
}

function openConfirm(): void {
  amountTouched.value = true;
  if (!member.value || memberBlock.value || amountMsg.value || !storeId.value) {
    return;
  }
  requestId = newRequestId();
  submitError.value = '';
  confirmOpen.value = true;
}

async function submit(): Promise<void> {
  if (!member.value || amountCent.value === null || !storeId.value) {
    return;
  }
  submitting.value = true;
  submitError.value = '';
  const body = {
    storeId: storeId.value,
    amountCent: amountCent.value,
    remark: remark.value.trim() || undefined,
    requestId,
  };
  try {
    const call = props.kind === 'RECHARGE' ? recharge : consume;
    result.value = await call(member.value.id, body);
    confirmOpen.value = false;
  } catch (e) {
    submitError.value = isNetworkError(e)
      ? '网络不稳定，没收到结果。再点一次确认不会重复记账。'
      : errorMessage(e);
  } finally {
    submitting.value = false;
  }
}

async function again(): Promise<void> {
  const memberId = result.value?.entry.memberId;
  result.value = null;
  amount.value = '';
  amountTouched.value = false;
  remark.value = '';
  if (memberId) {
    await loadMember(memberId);
  }
}

function restart(): void {
  result.value = null;
  amount.value = '';
  amountTouched.value = false;
  remark.value = '';
  member.value = null;
  lookupRef.value?.reset();
  void router.replace({ query: {} });
}

watch(
  () => props.kind,
  () => {
    restart();
    defaultStore();
  },
);

watch(() => session.currentStoreId, defaultStore);

defaultStore();
if (typeof route.query.memberId === 'string') {
  void loadMember(route.query.memberId);
}
</script>

<style scoped>
.page {
  max-width: 880px;
}

.block {
  margin-bottom: 12px;
  border-radius: 12px;
}

.gap {
  margin-top: 12px;
}

.confirm-amount {
  font-size: 36px;
  font-weight: 600;
  text-align: center;
  margin: 8px 0 16px;
}

.confirm-amount .unit {
  font-size: 16px;
  font-weight: 400;
  color: #64748b;
}

.result-balance {
  margin-top: 12px;
  color: #0f172a;
}

.result-balance .num {
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
