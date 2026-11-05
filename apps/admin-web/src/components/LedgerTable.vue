<template>
  <a-table
    :columns="columns"
    :data-source="entries"
    :loading="loading"
    :pagination="pagination"
    row-key="id"
    size="middle"
    :scroll="{ x: showMember ? 1120 : 990 }"
    @change="onChange"
  >
    <template #emptyText>
      <a-empty :description="emptyText" />
    </template>
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'createdAt'">
        <span class="pm-num nowrap">{{ formatDateTime(record.createdAt) }}</span>
      </template>
      <template v-else-if="column.key === 'member'">
        <router-link :to="{ name: 'member-detail', params: { id: record.memberId } }">
          {{ record.memberName || '未填称呼' }}
        </router-link>
        <div class="muted">{{ maskPhone(record.memberPhone) }}</div>
      </template>
      <template v-else-if="column.key === 'type'">
        <LedgerTypeTag :type="record.type" />
        <a-tag v-if="record.reversedById" class="reversed">已冲正</a-tag>
      </template>
      <template v-else-if="column.key === 'change'">
        <MoneyText :cent="record.changeCent" signed class="change" />
      </template>
      <template v-else-if="column.key === 'order'">
        <template v-if="record.orderNo">
          <span class="pm-num">{{ record.orderNo }}</span>
          <a-tag v-if="record.orderNoTyped" color="orange" class="typed">手输</a-tag>
          <div v-if="record.productAmountCent != null" class="muted">商品 {{ formatCent(record.productAmountCent) }}</div>
        </template>
      </template>
      <template v-else-if="column.key === 'balanceAfter'">
        <MoneyText :cent="record.balanceAfter" />
      </template>
      <template v-else-if="column.key === 'store'">
        {{ record.storeName }}
        <div class="muted">{{ record.operatorName || '系统' }}</div>
      </template>
      <template v-else-if="column.key === 'remark'">
        <span class="remark">{{ record.remark || '' }}</span>
      </template>
      <template v-else-if="column.key === 'actions'">
        <a-space :size="4">
          <a-button type="link" size="small" @click="emit('detail', record)">详情</a-button>
          <a-button v-if="canReverseEntry(record)" type="link" size="small" danger @click="emit('reverse', record)">
            冲正
          </a-button>
        </a-space>
      </template>
    </template>
  </a-table>
</template>

<script setup lang="ts">
import type { TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed } from 'vue';
import type { LedgerEntry } from '../api/types';
import { useSessionStore } from '../stores/session';
import { formatDateTime } from '../utils/datetime';
import { formatCent } from '../utils/money';
import { maskPhone } from '../utils/phone';
import { canReverse } from '../utils/roles';
import LedgerTypeTag from './LedgerTypeTag.vue';
import MoneyText from './MoneyText.vue';

const props = withDefaults(
  defineProps<{
    entries: LedgerEntry[];
    loading?: boolean;
    total: number;
    page: number;
    pageSize: number;
    showMember?: boolean;
    emptyText?: string;
  }>(),
  { loading: false, showMember: true, emptyText: '还没有流水' },
);

const emit = defineEmits<{
  detail: [entry: LedgerEntry];
  reverse: [entry: LedgerEntry];
  page: [page: number, pageSize: number];
}>();

const session = useSessionStore();

function canReverseEntry(entry: LedgerEntry): boolean {
  return canReverse(session.roles, entry);
}

const columns = computed<ColumnsType<LedgerEntry>>(() => [
  { title: '时间', key: 'createdAt', width: 160 },
  ...(props.showMember ? [{ title: '会员', key: 'member', width: 130 }] : []),
  { title: '类型', key: 'type', width: 130 },
  { title: '金额（元）', key: 'change', align: 'right' as const, width: 110 },
  { title: '九讯云订单', key: 'order', width: 130 },
  // 门店和操作人并成一列（操作人在下一行），给九讯云订单腾地方，1440 宽屏幕不用左右拖就能看到备注。
  { title: '余额（元）', key: 'balanceAfter', align: 'right' as const, width: 110 },
  { title: '门店 / 操作人', key: 'store', width: 120 },
  { title: '备注', key: 'remark', ellipsis: true },
  { title: '操作', key: 'actions', width: 120, fixed: 'right' as const },
]);

const pagination = computed<TablePaginationConfig>(() => ({
  current: props.page,
  pageSize: props.pageSize,
  total: props.total,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
}));

function onChange(p: TablePaginationConfig): void {
  emit('page', p.current ?? 1, p.pageSize ?? props.pageSize);
}
</script>

<style scoped>
.muted {
  color: #64748b;
  font-size: 12px;
}

.nowrap {
  white-space: nowrap;
}

.change {
  font-weight: 500;
}

.typed {
  margin-left: 4px;
}

.reversed {
  margin-left: 4px;
  color: #64748b;
}

.remark {
  color: #64748b;
}
</style>
