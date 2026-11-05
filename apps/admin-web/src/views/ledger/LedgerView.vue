<template>
  <div>
    <h1 class="pm-page-title">流水查询</h1>
    <p class="pm-page-sub">
      {{ session.superAdmin ? '可以查全公司所有门店的流水。' : '只能查在你的门店发生的流水。' }}
      流水不能删改，记错了用「冲正」补记一笔反方向的抵掉。和九讯云对账时按单号查，或把查出来的流水导出成表格。
    </p>
    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-input
          v-model:value="filters.phone"
          placeholder="会员完整手机号"
          allow-clear
          :maxlength="13"
          style="width: 180px"
          @press-enter="reload(1)"
        />
        <a-input
          v-model:value="filters.orderNo"
          placeholder="九讯云单号"
          allow-clear
          :maxlength="12"
          style="width: 140px"
          @press-enter="reload(1)"
        />
        <a-select
          v-model:value="filters.storeId"
          :options="storeOptions"
          placeholder="全部门店"
          allow-clear
          style="width: 160px"
        />
        <a-select
          v-model:value="filters.type"
          :options="LEDGER_TYPE_OPTIONS"
          placeholder="全部类型"
          allow-clear
          style="width: 120px"
        />
        <a-range-picker
          v-model:value="filters.range"
          value-format="YYYY-MM-DD"
          :allow-empty="[true, true]"
          style="width: 280px"
        />
        <span class="pm-toolbar-actions">
          <a-button type="primary" @click="reload(1)">查询</a-button>
          <a-button @click="resetFilters">重置</a-button>
          <a-button :loading="exporting" @click="exportCsv">导出表格</a-button>
        </span>
      </div>
      <a-alert v-if="filterError" class="gap" type="warning" show-icon :message="filterError" />
      <LedgerTable
        :entries="entries"
        :loading="loading"
        :total="total"
        :page="page"
        :page-size="pageSize"
        :empty-text="hasFilters ? '没有符合条件的流水' : '还没有流水'"
        @page="onPage"
        @detail="(e: LedgerEntry) => (detail = e)"
        @reverse="startReverse"
      />
    </a-card>
    <LedgerDetailDrawer :open="!!detail" :entry="detail" @close="detail = null" @reverse="startReverse" @jump="jump" />
    <ReversalModal :open="!!reversing" :entry="reversing" @close="reversing = null" @done="afterReverse" />
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '../../api/http';
import { getLedgerEntry, listLedger, type LedgerQuery } from '../../api/ledger';
import { findMemberByPhone } from '../../api/members';
import type { LedgerEntry, LedgerType } from '../../api/types';
import LedgerDetailDrawer from '../../components/LedgerDetailDrawer.vue';
import LedgerTable from '../../components/LedgerTable.vue';
import ReversalModal from '../../components/ReversalModal.vue';
import { useSessionStore } from '../../stores/session';
import { dayStart, nextDayStart } from '../../utils/datetime';
import { downloadText } from '../../utils/download';
import { LEDGER_TYPE_LABEL, LEDGER_TYPE_OPTIONS, ledgerCsv, normalizeOrderNo } from '../../utils/ledger';
import { isMobile, normalizePhone } from '../../utils/phone';

const route = useRoute();
const session = useSessionStore();

const filters = reactive<{
  phone: string;
  orderNo: string;
  storeId: string | undefined;
  type: LedgerType | undefined;
  range: [string | null, string | null] | null;
}>({
  phone: '',
  orderNo: typeof route.query.orderNo === 'string' ? route.query.orderNo : '',
  storeId: typeof route.query.storeId === 'string' ? route.query.storeId : undefined,
  type:
    typeof route.query.type === 'string' && route.query.type in LEDGER_TYPE_LABEL
      ? (route.query.type as LedgerType)
      : undefined,
  range: typeof route.query.date === 'string' ? [route.query.date, route.query.date] : null,
});

const entries = ref<LedgerEntry[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filterError = ref('');
const detail = ref<LedgerEntry | null>(null);
const reversing = ref<LedgerEntry | null>(null);
const exporting = ref(false);

/** 一次最多导出这么多条；再多请缩小时间范围或按门店分开导。 */
const EXPORT_LIMIT = 5000;
const EXPORT_PAGE_SIZE = 100;

const storeOptions = computed(() => session.stores.map((s) => ({ value: s.id, label: s.name })));
const hasFilters = computed(
  () =>
    !!(
      filters.phone ||
      filters.orderNo ||
      filters.storeId ||
      filters.type ||
      filters.range?.[0] ||
      filters.range?.[1]
    ),
);

async function buildQuery(): Promise<LedgerQuery | null> {
  const query: LedgerQuery = { page: page.value, pageSize: pageSize.value };
  const phone = filters.phone.trim();
  if (phone) {
    if (!isMobile(phone)) {
      filterError.value = '请输入完整的 11 位手机号';
      return null;
    }
    const member = await findMemberByPhone(normalizePhone(phone));
    if (!member) {
      filterError.value = '没有找到这个手机号的会员';
      return null;
    }
    query.memberId = member.id;
  }
  if (filters.orderNo.trim()) {
    const orderNo = normalizeOrderNo(filters.orderNo);
    if (!orderNo) {
      filterError.value = '单号只能是数字，照小票上「单号」那一行输入，例如 5982';
      return null;
    }
    query.orderNo = orderNo;
  }
  if (filters.storeId) {
    query.storeId = filters.storeId;
  }
  if (filters.type) {
    query.type = filters.type;
  }
  const [from, to] = filters.range ?? [null, null];
  if (from) {
    query.from = dayStart(from);
  }
  if (to) {
    query.to = nextDayStart(to);
  }
  return query;
}

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  filterError.value = '';
  loading.value = true;
  try {
    const query = await buildQuery();
    if (!query) {
      entries.value = [];
      total.value = 0;
      return;
    }
    const result = await listLedger(query);
    entries.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

/** 按当前条件把流水全部查出来存成 CSV（Excel 能直接打开），给和九讯云对账用。 */
async function exportCsv(): Promise<void> {
  if (exporting.value) {
    return;
  }
  filterError.value = '';
  exporting.value = true;
  try {
    const base = await buildQuery();
    if (!base) {
      return;
    }
    const rows = new Map<string, LedgerEntry>();
    for (let p = 1; ; p += 1) {
      const result = await listLedger({ ...base, page: p, pageSize: EXPORT_PAGE_SIZE });
      if (result.total > EXPORT_LIMIT) {
        message.warning(`符合条件的有 ${result.total} 条，一次最多导出 ${EXPORT_LIMIT} 条，请缩小时间范围或选门店后再导`);
        return;
      }
      for (const item of result.items) {
        rows.set(item.id, item);
      }
      if (result.items.length < EXPORT_PAGE_SIZE || p * EXPORT_PAGE_SIZE >= result.total) {
        break;
      }
    }
    if (!rows.size) {
      message.info('没有符合条件的流水可以导出');
      return;
    }
    downloadText(`流水-${dayjs().format('YYYYMMDD-HHmm')}.csv`, ledgerCsv([...rows.values()]));
    message.success(`已导出 ${rows.size} 条`);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    exporting.value = false;
  }
}

function resetFilters(): void {
  filters.phone = '';
  filters.orderNo = '';
  filters.storeId = undefined;
  filters.type = undefined;
  filters.range = null;
  void reload(1);
}

function onPage(p: number, size: number): void {
  pageSize.value = size;
  void reload(p);
}

function startReverse(entry: LedgerEntry): void {
  detail.value = null;
  reversing.value = entry;
}

async function jump(id: string): Promise<void> {
  try {
    detail.value = await getLedgerEntry(id);
  } catch (e) {
    message.error(errorMessage(e));
  }
}

async function afterReverse(): Promise<void> {
  reversing.value = null;
  await reload();
}

onMounted(() => reload(1));
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.gap {
  margin-bottom: 12px;
}
</style>
