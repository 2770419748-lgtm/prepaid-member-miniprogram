<template>
  <div>
    <h1 class="pm-page-title">操作记录</h1>
    <p class="pm-page-sub">{{ scopeText }}记录只能查看，不能修改或删除。</p>
    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-select
          v-model:value="filters.action"
          :options="actionOptions"
          placeholder="全部操作"
          allow-clear
          show-search
          option-filter-prop="label"
          style="width: 160px"
        />
        <a-select v-model:value="filters.storeId" :options="storeOptions" placeholder="全部门店" allow-clear style="width: 160px" />
        <a-range-picker v-model:value="filters.range" value-format="YYYY-MM-DD" :allow-empty="[true, true]" />
        <a-button type="primary" @click="reload(1)">查询</a-button>
        <a-button @click="resetFilters">重置</a-button>
      </div>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        size="middle"
        :scroll="{ x: 900 }"
        @change="onTableChange"
      >
        <template #emptyText><a-empty description="没有符合条件的记录" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'createdAt'">
            <span class="pm-num nowrap">{{ formatDateTime(record.createdAt) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-tag :color="actionColor(record.action)" class="tag">{{ record.actionLabel }}</a-tag>
          </template>
          <template v-else-if="column.key === 'actor'">{{ record.actorName || '会员本人 / 系统' }}</template>
          <template v-else-if="column.key === 'store'">
            <span :class="{ muted: !record.storeName }">{{ record.storeName || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'content'">
            <span class="content">{{ describe(record).join('；') || '—' }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-button type="link" size="small" @click="detail = record">详情</a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-drawer :open="!!detail" title="操作详情" :width="460" @close="detail = null">
      <template v-if="detail">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="操作">{{ detail.actionLabel }}</a-descriptions-item>
          <a-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="操作人">{{ detail.actorName || '会员本人 / 系统' }}</a-descriptions-item>
          <a-descriptions-item label="门店">{{ detail.storeName || '—' }}</a-descriptions-item>
          <a-descriptions-item label="内容">
            <div v-for="line in describe(detail)" :key="line">{{ line }}</div>
            <span v-if="describe(detail).length === 0">—</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="detail.targetType === 'LedgerEntry' && detail.targetId" label="对应流水">
            <a @click="openEntry(detail.targetId)">查看这笔流水</a>
          </a-descriptions-item>
          <a-descriptions-item v-if="detail.targetType === 'Member' && detail.targetId" label="对应会员">
            <router-link :to="{ name: 'member-detail', params: { id: detail.targetId } }">查看会员</router-link>
          </a-descriptions-item>
        </a-descriptions>
        <div class="raw-title">原始内容</div>
        <pre class="raw">{{ JSON.stringify(detail.payload, null, 2) }}</pre>
      </template>
    </a-drawer>
    <LedgerDetailDrawer :open="!!entry" :entry="entry" @close="entry = null" @jump="openEntry" />
  </div>
</template>

<script setup lang="ts">
import { message, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, reactive, ref } from 'vue';
import { listAuditActions, listAuditLogs, type AuditLogItem, type AuditQuery } from '../../api/audit';
import { errorMessage } from '../../api/http';
import { getLedgerEntry } from '../../api/ledger';
import type { LedgerEntry } from '../../api/types';
import LedgerDetailDrawer from '../../components/LedgerDetailDrawer.vue';
import { useSessionStore } from '../../stores/session';
import { describeAuditPayload } from '../../utils/audit';
import { dayStart, formatDateTime, nextDayStart } from '../../utils/datetime';

const session = useSessionStore();

const filters = reactive<{
  action: string | undefined;
  storeId: string | undefined;
  range: [string | null, string | null] | null;
}>({
  action: undefined,
  storeId: undefined,
  range: null,
});
const actions = ref<{ action: string; label: string }[]>([]);
const rows = ref<AuditLogItem[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const detail = ref<AuditLogItem | null>(null);
const entry = ref<LedgerEntry | null>(null);

const scopeText = computed(() => {
  if (session.superAdmin) {
    return '全公司所有员工的关键操作：开卡、记账、冲正、门店和员工变动、改密码等。';
  }
  if (session.managed.length > 0) {
    return '你管理的门店里发生的操作，以及你自己做的操作。';
  }
  return '你自己做过的操作。';
});

const actionOptions = computed(() => actions.value.map((a) => ({ value: a.action, label: a.label })));
const storeOptions = computed(() => session.stores.map((s) => ({ value: s.id, label: s.name })));

const columns: ColumnsType<AuditLogItem> = [
  { title: '时间', key: 'createdAt', width: 160 },
  { title: '操作', key: 'action', width: 120 },
  { title: '操作人', key: 'actor', width: 120 },
  { title: '门店', key: 'store', width: 110 },
  { title: '内容', key: 'content', ellipsis: true },
  { title: '', key: 'actions', width: 70, fixed: 'right' },
];

const pagination = computed<TablePaginationConfig>(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  showTotal: (n: number) => `共 ${n} 条`,
}));

function storeName(id: string): string | null {
  return session.stores.find((s) => s.id === id)?.name ?? null;
}

function describe(item: AuditLogItem): string[] {
  return describeAuditPayload(item.payload, storeName);
}

function actionColor(action: string): string {
  if (action === 'WALLET_REVERSAL') {
    return 'warning';
  }
  if (action.startsWith('WALLET_')) {
    return 'blue';
  }
  if (action.includes('PASSWORD')) {
    return 'purple';
  }
  return 'default';
}

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  loading.value = true;
  const query: AuditQuery = { page: page.value, pageSize: pageSize.value };
  if (filters.action) {
    query.action = filters.action;
  }
  if (filters.storeId) {
    query.storeId = filters.storeId;
  }
  const [from, to] = filters.range ?? [null, null];
  if (from) {
    query.from = dayStart(from);
  }
  if (to) {
    query.to = nextDayStart(to);
  }
  try {
    const result = await listAuditLogs(query);
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

function resetFilters(): void {
  filters.action = undefined;
  filters.storeId = undefined;
  filters.range = null;
  void reload(1);
}

function onTableChange(p: TablePaginationConfig): void {
  pageSize.value = p.pageSize ?? pageSize.value;
  void reload(p.current ?? 1);
}

async function openEntry(id: string): Promise<void> {
  try {
    entry.value = await getLedgerEntry(id);
    detail.value = null;
  } catch (e) {
    message.error(errorMessage(e, '这笔流水不在你能查看的范围内'));
  }
}

onMounted(async () => {
  void reload(1);
  try {
    actions.value = await listAuditActions();
  } catch {
    actions.value = [];
  }
});
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.tag {
  margin: 0;
}

.muted {
  color: #94a3b8;
}

.nowrap {
  white-space: nowrap;
}

.content {
  color: #334155;
}

.raw-title {
  margin: 24px 0 8px;
  color: #64748b;
  font-size: 12px;
}

.raw {
  margin: 0;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
