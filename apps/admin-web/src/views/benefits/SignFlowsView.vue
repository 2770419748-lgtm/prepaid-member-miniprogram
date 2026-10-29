<template>
  <div>
    <h1 class="pm-page-title">权益单签署</h1>
    <p class="pm-page-sub">
      给会员发起线上签署，会员用手机微信扫码，阅读后签字。
      {{ session.superAdmin ? '' : '只显示在你的门店发起的签署。' }}
    </p>

    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-select
          v-model:value="filters.status"
          :options="SIGN_STATUS_OPTIONS"
          placeholder="全部状态"
          allow-clear
          style="width: 140px"
          @change="reload(1)"
        />
        <a-select
          v-model:value="filters.storeId"
          :options="storeOptions"
          placeholder="全部门店"
          allow-clear
          style="width: 160px"
          @change="reload(1)"
        />
        <a-tag v-if="memberFilter" closable @close="clearMemberFilter">只看：{{ memberFilter }}</a-tag>
        <span class="pm-spacer" />
        <a-button type="primary" @click="openStart()">发起签署</a-button>
      </div>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        :scroll="{ x: 1120 }"
        @change="(p: TablePaginationConfig) => reload(p.current ?? 1)"
      >
        <template #emptyText><a-empty description="还没有发起过签署" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'member'">
            <router-link :to="{ name: 'member-detail', params: { id: record.member.id } }">
              {{ record.member.name || '未填称呼' }}
            </router-link>
            <div class="muted">{{ maskPhone(record.member.phone) }}</div>
          </template>
          <template v-else-if="column.key === 'title'">
            <div>{{ record.title || record.template.name }}</div>
            <div class="muted">{{ record.benefitPlan?.title ?? record.template.name }}</div>
            <div v-if="record.rechargeAmountCent != null" class="muted pm-num">
              会员权益金额 {{ formatCent(record.rechargeAmountCent) }} 元 · {{ rechargeText(record) }}
            </div>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="SIGN_STATUS[record.status as SignFlowStatus].color" class="tag">
              {{ SIGN_STATUS[record.status as SignFlowStatus].label }}
            </a-tag>
            <a-tag v-if="record.env === 'SANDBOX'" class="tag">测试签署</a-tag>
          </template>
          <template v-else-if="column.key === 'store'">{{ record.store?.name ?? '—' }}</template>
          <template v-else-if="column.key === 'initiator'">{{ record.initiator?.name ?? '—' }}</template>
          <template v-else-if="column.key === 'time'">
            <div class="pm-num nowrap">{{ formatDateTime(record.createdAt) }} 发起</div>
            <div v-if="record.signedAt" class="pm-num nowrap muted">{{ formatDateTime(record.signedAt) }} 签署</div>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space :size="4" wrap>
              <a-button v-if="record.signUrl" type="link" size="small" @click="showQr(record)">签署码</a-button>
              <!-- 签完但合同还没归档时也要能再刷新，后端会重试归档。 -->
              <a-button
                v-if="record.status === 'PENDING' || record.status === 'DRAFT' || (record.status === 'SIGNED' && !record.hasPdf)"
                type="link"
                size="small"
                :loading="refreshing === record.id"
                @click="refresh(record)"
              >
                刷新状态
              </a-button>
              <a-button v-if="record.hasPdf" type="link" size="small" @click="download(record)">下载 PDF</a-button>
              <a-button v-if="canCancel(record)" type="link" size="small" danger @click="startCancel(record)">撤销</a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 发起签署 -->
    <a-modal
      :open="startOpen"
      title="发起权益单签署"
      :footer="null"
      :mask-closable="false"
      width="560px"
      @cancel="startOpen = false"
    >
      <template v-if="created">
        <a-result status="success" title="已发起，请会员扫码签署" class="result">
          <template #subTitle>
            {{ created.member.name || '未填称呼' }} · {{ maskPhone(created.member.phone) }} · {{ created.template.name }}
          </template>
        </a-result>
        <SignQr :flow="created" />
        <div class="actions">
          <a-button type="primary" @click="startOpen = false">完成</a-button>
        </div>
      </template>
      <template v-else>
        <a-form layout="vertical">
          <a-form-item label="会员" required>
            <MemberCardPanel v-if="startMember" :member="startMember">
              <a-button size="small" @click="startMember = null">换个会员</a-button>
            </MemberCardPanel>
            <MemberLookup v-else @found="(m: MemberCard) => (startMember = m)" />
          </a-form-item>
          <a-form-item label="权益单模板" required>
            <a-select v-model:value="startTemplateId" :options="templateOptions" placeholder="选择已启用的模板" :not-found-content="templateEmpty" />
          </a-form-item>
          <a-form-item label="发起门店" required>
            <a-select v-model:value="startStoreId" :options="activeStoreOptions" />
          </a-form-item>
          <a-alert type="warning" show-icon class="gap" message="测试环境（沙箱）：签出来的权益单不具法律效力。" />
          <a-alert v-if="startError" type="error" show-icon class="gap" :message="startError" />
          <a-button type="primary" block size="large" :loading="starting" :disabled="!startMember || !startTemplateId || !startStoreId" @click="submitStart">
            发起签署
          </a-button>
        </a-form>
      </template>
    </a-modal>

    <!-- 签署码 -->
    <a-modal :open="!!qrFlow" title="签署码" :footer="null" @cancel="qrFlow = null">
      <SignQr v-if="qrFlow" :flow="qrFlow" />
    </a-modal>

    <!-- 撤销 -->
    <a-modal
      :open="!!cancelling"
      title="撤销这份签署？"
      ok-text="确认撤销"
      cancel-text="取消"
      :ok-button-props="{ danger: true, loading: cancelBusy, disabled: !cancelReason.trim() }"
      @ok="submitCancel"
      @cancel="cancelling = null"
    >
      <p class="muted">撤销后会员不能再签这份权益单，需要的话可以重新发起。</p>
      <a-textarea v-model:value="cancelReason" :rows="2" :maxlength="100" placeholder="撤销原因，例如：模板选错了" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  cancelSignFlow,
  createSignFlow,
  downloadSignedPdf,
  listSignFlows,
  listTemplates,
  refreshSignFlow,
  type ContractTemplate,
  type SignFlow,
  type SignFlowQuery,
  type SignFlowStatus,
} from '../../api/esign';
import { errorMessage, errorStatus, isNetworkError, isNotFound } from '../../api/http';
import { getMember } from '../../api/members';
import type { MemberCard } from '../../api/types';
import MemberCardPanel from '../../components/MemberCardPanel.vue';
import MemberLookup from '../../components/MemberLookup.vue';
import SignQr from '../../components/SignQr.vue';
import { useSessionStore } from '../../stores/session';
import { formatDateTime } from '../../utils/datetime';
import { rechargeText, SIGN_STATUS, SIGN_STATUS_OPTIONS } from '../../utils/esign';
import { formatCent } from '../../utils/money';
import { maskPhone } from '../../utils/phone';
import { newRequestId } from '../../utils/request-id';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const rows = ref<SignFlow[]>([]);
const loading = ref(false);
const page = ref(1);
const total = ref(0);
const filters = reactive<{ status: SignFlowStatus | undefined; storeId: string | undefined; memberId: string | undefined }>({
  status: undefined,
  storeId: undefined,
  memberId: typeof route.query.memberId === 'string' ? route.query.memberId : undefined,
});
const memberFilter = ref('');

const columns: ColumnsType<SignFlow> = [
  { title: '会员', key: 'member', width: 130 },
  { title: '权益单', key: 'title' },
  { title: '状态', key: 'status', width: 170 },
  { title: '门店', key: 'store', width: 110 },
  { title: '发起人', key: 'initiator', width: 120 },
  { title: '时间', key: 'time', width: 200 },
  { title: '操作', key: 'actions', width: 200, fixed: 'right' },
];

const pagination = computed<TablePaginationConfig>(() => ({
  current: page.value,
  pageSize: 20,
  total: total.value,
  showTotal: (n: number) => `共 ${n} 份`,
}));

const storeOptions = computed(() => session.stores.map((s) => ({ value: s.id, label: s.name })));
const activeStoreOptions = computed(() => session.activeStores.map((s) => ({ value: s.id, label: s.name })));

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  loading.value = true;
  const query: SignFlowQuery = { page: page.value, pageSize: 20 };
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.storeId) {
    query.storeId = filters.storeId;
  }
  if (filters.memberId) {
    query.memberId = filters.memberId;
  }
  try {
    const result = await listSignFlows(query);
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

function clearMemberFilter(): void {
  filters.memberId = undefined;
  memberFilter.value = '';
  void router.replace({ query: {} });
  void reload(1);
}

function canCancel(flow: SignFlow): boolean {
  return flow.status === 'PENDING' && (session.superAdmin || (!!flow.store && session.canManage(flow.store.id)));
}

// 发起签署
const startOpen = ref(false);
const startMember = ref<MemberCard | null>(null);
const startTemplateId = ref<string | undefined>(undefined);
const startStoreId = ref<string | undefined>(undefined);
const templates = ref<ContractTemplate[]>([]);
const starting = ref(false);
const startError = ref('');
const created = ref<SignFlow | null>(null);
let startRequestId = newRequestId();

const templateOptions = computed(() =>
  templates.value.map((t) => ({ value: t.id, label: t.benefitPlan ? `${t.name}（${t.benefitPlan.title}）` : t.name })),
);
const templateEmpty = computed(() => (session.superAdmin ? '还没有启用的模板，先去「权益单模板」绑定' : '还没有启用的模板，请联系超级管理员'));

async function openStart(member?: MemberCard | null): Promise<void> {
  created.value = null;
  startError.value = '';
  startMember.value = member ?? null;
  const current = session.currentStore;
  startStoreId.value = current && current.status === 'ACTIVE' ? current.id : session.activeStores[0]?.id;
  startRequestId = newRequestId();
  startOpen.value = true;
  try {
    templates.value = (await listTemplates({ status: 'ACTIVE', pageSize: 100 })).items;
    if (typeof route.query.templateId === 'string' && templates.value.some((t) => t.id === route.query.templateId)) {
      startTemplateId.value = route.query.templateId;
    } else if (templates.value.length === 1) {
      startTemplateId.value = templates.value[0].id;
    }
  } catch (e) {
    startError.value = errorMessage(e);
  }
}

// 换了会员、模板或门店就是另一次发起，要换请求号；内容不变的重试沿用同一个号，不会重复发起。
watch([() => startMember.value?.id, startTemplateId, startStoreId], () => {
  startRequestId = newRequestId();
});

async function submitStart(): Promise<void> {
  if (!startMember.value || !startTemplateId.value || !startStoreId.value) {
    return;
  }
  starting.value = true;
  startError.value = '';
  try {
    created.value = await createSignFlow({
      memberId: startMember.value.id,
      templateId: startTemplateId.value,
      storeId: startStoreId.value,
      requestId: startRequestId,
    });
    void reload(1);
  } catch (e) {
    if (isNetworkError(e)) {
      startError.value = '网络不稳定，没收到结果。再点一次不会重复发起。';
    } else if (errorStatus(e) === 502) {
      startError.value = `电子签服务暂时没有响应：${errorMessage(e)}`;
    } else if (errorStatus(e) === 503) {
      startError.value = '电子签沙箱账号还没配置，暂时不能发起。请联系技术人员。';
    } else {
      startError.value = errorMessage(e);
    }
  } finally {
    starting.value = false;
  }
}

// 签署码
const qrFlow = ref<SignFlow | null>(null);

function showQr(flow: SignFlow): void {
  qrFlow.value = flow;
}

// 刷新、下载、撤销
const refreshing = ref<string | null>(null);

async function refresh(flow: SignFlow): Promise<void> {
  refreshing.value = flow.id;
  try {
    const updated = await refreshSignFlow(flow.id);
    const index = rows.value.findIndex((r) => r.id === flow.id);
    if (index >= 0) {
      rows.value[index] = updated;
    }
    message.success(`当前状态：${SIGN_STATUS[updated.status].label}`);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    refreshing.value = null;
  }
}

async function download(flow: SignFlow): Promise<void> {
  try {
    await downloadSignedPdf(flow);
  } catch (e) {
    message.error(isNotFound(e) ? 'PDF 还在归档中，稍后点「刷新状态」再试' : errorMessage(e));
  }
}

const cancelling = ref<SignFlow | null>(null);
const cancelReason = ref('');
const cancelBusy = ref(false);

function startCancel(flow: SignFlow): void {
  cancelling.value = flow;
  cancelReason.value = '';
}

async function submitCancel(): Promise<void> {
  if (!cancelling.value) {
    return;
  }
  cancelBusy.value = true;
  try {
    await cancelSignFlow(cancelling.value.id, cancelReason.value.trim());
    message.success('已撤销');
    cancelling.value = null;
    await reload();
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    cancelBusy.value = false;
  }
}

onMounted(async () => {
  await reload(1);
  if (filters.memberId) {
    const member = await getMember(filters.memberId).catch(() => null);
    memberFilter.value = member ? `${member.name || '未填称呼'} ${maskPhone(member.phone)}` : '这位会员';
    if (route.query.start === '1') {
      void openStart(member);
    }
  } else if (route.query.start === '1') {
    void openStart();
  }
});
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.muted {
  color: #64748b;
  font-size: 12px;
}

.nowrap {
  white-space: nowrap;
}

.tag {
  margin: 0 4px 0 0;
}

.gap {
  margin-bottom: 12px;
}

.result {
  padding: 8px 0 0;
}

.actions {
  margin-top: 16px;
  text-align: center;
}
</style>
