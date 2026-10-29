<template>
  <div>
    <h1 class="pm-page-title">当日对账</h1>
    <p class="pm-page-sub">
      按北京时间一天汇总每家门店的充值、消费和冲正，用来和门店当天线下实收对账。
      {{ session.superAdmin ? '' : '只显示你所在门店的数字。' }}
    </p>

    <div class="pm-toolbar">
      <a-date-picker v-model:value="date" value-format="YYYY-MM-DD" :allow-clear="false" :disabled-date="future" />
      <a-select v-model:value="storeId" :options="storeOptions" placeholder="全部门店" allow-clear style="width: 180px" />
      <a-button type="primary" @click="load">查询</a-button>
    </div>

    <a-alert v-if="error" class="gap" type="error" show-icon :message="error" />

    <div class="figures" :class="{ 'has-balance': !!report?.balance }">
      <div class="figure">
        <div class="label">净充值（元）</div>
        <div class="value pm-amount-plus">{{ report ? formatCent(report.total.netRechargeCent) : '—' }}</div>
        <div class="note">{{ report ? `${report.total.rechargeCount} 笔，合计 ${formatCent(report.total.rechargeCent)} 元${minus(report.total.reversedRechargeCent)}` : '' }}</div>
      </div>
      <div class="figure">
        <div class="label">净消费（元）</div>
        <div class="value pm-amount-minus">{{ report ? formatCent(report.total.netConsumeCent) : '—' }}</div>
        <div class="note">{{ report ? `${report.total.consumeCount} 笔，合计 ${formatCent(report.total.consumeCent)} 元${minus(report.total.reversedConsumeCent)}` : '' }}</div>
      </div>
      <div class="figure">
        <div class="label">冲正</div>
        <div class="value">{{ report ? report.total.reversalCount : '—' }}<span class="unit">笔</span></div>
        <div class="note">记错了账，补记一笔反方向的抵掉</div>
      </div>
      <div v-if="report?.balance" class="figure wide">
        <div class="label">全公司储值余额（元）</div>
        <div class="balance-line">
          <div>
            <div class="small">日初</div>
            <div class="num">{{ formatCent(report.balance.openingCent) }}</div>
          </div>
          <div class="op">{{ report.balance.netChangeCent >= 0 ? '+' : '−' }}</div>
          <div>
            <div class="small">当日变动</div>
            <div class="num">{{ formatCent(Math.abs(report.balance.netChangeCent)) }}</div>
          </div>
          <div class="op">=</div>
          <div>
            <div class="small">日末</div>
            <div class="num strong">{{ formatCent(report.balance.closingCent) }}</div>
          </div>
        </div>
      </div>
    </div>

    <a-card :bordered="false" class="block" title="分门店">
      <a-table
        :columns="columns"
        :data-source="report?.stores ?? []"
        :loading="loading"
        :pagination="false"
        row-key="storeId"
        size="middle"
        :scroll="{ x: 960 }"
      >
        <template #emptyText><a-empty description="没有可对账的门店" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'store'">
            {{ record.storeName }}
            <a-tag v-if="record.storeStatus === 'DISABLED'" class="tag">已停用</a-tag>
          </template>
          <template v-else-if="column.key === 'recharge'">
            <span class="pm-num">{{ formatCent(record.rechargeCent) }}</span>
            <span class="count">{{ record.rechargeCount }} 笔</span>
          </template>
          <template v-else-if="column.key === 'consume'">
            <span class="pm-num">{{ formatCent(record.consumeCent) }}</span>
            <span class="count">{{ record.consumeCount }} 笔</span>
          </template>
          <template v-else-if="column.key === 'reversal'">
            <template v-if="record.reversalCount > 0">
              <span class="count">{{ record.reversalCount }} 笔</span>
              <div v-if="record.reversedRechargeCent" class="sub">冲回充值 {{ formatCent(record.reversedRechargeCent) }}</div>
              <div v-if="record.reversedConsumeCent" class="sub">冲回消费 {{ formatCent(record.reversedConsumeCent) }}</div>
            </template>
            <span v-else class="muted">无</span>
          </template>
          <template v-else-if="column.key === 'netRecharge'">
            <span class="pm-num strong">{{ formatCent(record.netRechargeCent) }}</span>
          </template>
          <template v-else-if="column.key === 'netConsume'">
            <span class="pm-num strong">{{ formatCent(record.netConsumeCent) }}</span>
          </template>
          <template v-else-if="column.key === 'net'">
            <MoneyText :cent="record.netChangeCent" signed />
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-button type="link" size="small" @click="toLedger(record.storeId)">看流水</a-button>
          </template>
        </template>
        <template #summary>
          <a-table-summary v-if="report && report.stores.length > 1" fixed>
            <a-table-summary-row class="total">
              <a-table-summary-cell>合计</a-table-summary-cell>
              <a-table-summary-cell align="right">
                {{ formatCent(report.total.rechargeCent) }}<span class="count">{{ report.total.rechargeCount }} 笔</span>
              </a-table-summary-cell>
              <a-table-summary-cell align="right">
                {{ formatCent(report.total.consumeCent) }}<span class="count">{{ report.total.consumeCount }} 笔</span>
              </a-table-summary-cell>
              <a-table-summary-cell align="right">{{ report.total.reversalCount }} 笔</a-table-summary-cell>
              <a-table-summary-cell align="right">{{ formatCent(report.total.netRechargeCent) }}</a-table-summary-cell>
              <a-table-summary-cell align="right">{{ formatCent(report.total.netConsumeCent) }}</a-table-summary-cell>
              <a-table-summary-cell align="right"><MoneyText :cent="report.total.netChangeCent" signed /></a-table-summary-cell>
              <a-table-summary-cell />
            </a-table-summary-row>
          </a-table-summary>
        </template>
      </a-table>
      <p class="hint">金额单位：元。净充值 = 充值 − 被冲回的充值；净消费 = 消费 − 被冲回的消费。</p>
    </a-card>

    <a-card v-if="session.superAdmin" :bordered="false" class="block" title="余额核对">
      <p class="muted">
        逐张卡检查：卡上余额是不是等于它所有流水加减的结果，每一笔前后能不能接上。正常情况下永远对得上；对不上说明数据被动过，需要排查。
      </p>
      <a-button :loading="checking" @click="check">开始核对</a-button>
      <template v-if="checkResult">
        <a-alert
          v-if="checkResult.ok"
          class="check"
          type="success"
          show-icon
          message="全部对得上"
          :description="`${checkResult.walletCount} 张卡、${checkResult.entryCount} 笔流水。卡上余额合计 ${formatCent(checkResult.totalBalanceCent)} 元，流水加减合计 ${formatCent(checkResult.ledgerNetCent)} 元。核对时间 ${formatDateTime(checkResult.checkedAt)}。`"
        />
        <template v-else>
          <a-alert
            class="check"
            type="error"
            show-icon
            :message="`有 ${checkResult.mismatchCount} 张卡对不上`"
            :description="`卡上余额合计 ${formatCent(checkResult.totalBalanceCent)} 元，流水加减合计 ${formatCent(checkResult.ledgerNetCent)} 元。请把下面的名单发给技术支持排查。`"
          />
          <a-table :columns="mismatchColumns" :data-source="checkResult.mismatches" row-key="memberId" size="small" :pagination="false">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'member'">{{ record.memberName || '未填称呼' }} · {{ record.memberPhone }}</template>
              <template v-else-if="column.key === 'balance'">{{ formatCent(record.balanceCent) }}</template>
              <template v-else-if="column.key === 'ledger'">{{ formatCent(record.ledgerNetCent) }}</template>
            </template>
          </a-table>
        </template>
      </template>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import type { ColumnsType } from 'ant-design-vue/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../../api/http';
import {
  fetchDaily,
  runCheck,
  type CheckMismatch,
  type CheckResult,
  type DailyReport,
  type StoreDayFigures,
} from '../../api/reconciliation';
import MoneyText from '../../components/MoneyText.vue';
import { useSessionStore } from '../../stores/session';
import { formatDateTime } from '../../utils/datetime';
import { formatCent } from '../../utils/money';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const date = ref(typeof route.query.date === 'string' ? route.query.date : dayjs().format('YYYY-MM-DD'));
const storeId = ref<string | undefined>(undefined);
const report = ref<DailyReport | null>(null);
const loading = ref(false);
const error = ref('');
const checking = ref(false);
const checkResult = ref<CheckResult | null>(null);

const storeOptions = computed(() => session.stores.map((s) => ({ value: s.id, label: s.name })));

const columns: ColumnsType<StoreDayFigures> = [
  { title: '门店', key: 'store', width: 140 },
  { title: '充值', key: 'recharge', align: 'right', width: 150 },
  { title: '消费', key: 'consume', align: 'right', width: 150 },
  { title: '冲正', key: 'reversal', align: 'right', width: 150 },
  { title: '净充值', key: 'netRecharge', align: 'right', width: 120 },
  { title: '净消费', key: 'netConsume', align: 'right', width: 120 },
  { title: '余额净变动', key: 'net', align: 'right', width: 120 },
  { title: '', key: 'actions', width: 80 },
];

const mismatchColumns: ColumnsType<CheckMismatch> = [
  { title: '会员', key: 'member' },
  { title: '卡上余额', key: 'balance', align: 'right' },
  { title: '流水合计', key: 'ledger', align: 'right' },
  { title: '流水笔数', dataIndex: 'entryCount', align: 'right' },
  { title: '断开处', dataIndex: 'chainBreaks', align: 'right' },
];

function future(current: Dayjs): boolean {
  return current.isAfter(dayjs(), 'day');
}

function minus(cent: number): string {
  return cent > 0 ? `，冲回 ${formatCent(cent)} 元` : '';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    report.value = await fetchDaily({ date: date.value, storeId: storeId.value });
  } catch (e) {
    error.value = errorMessage(e);
    report.value = null;
  } finally {
    loading.value = false;
  }
}

async function check(): Promise<void> {
  checking.value = true;
  try {
    checkResult.value = await runCheck();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}

function toLedger(id: string): void {
  void router.push({ name: 'ledger', query: { storeId: id, date: date.value } });
}

onMounted(load);
</script>

<style scoped>
.gap {
  margin-bottom: 12px;
}

.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.figure {
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  min-height: 120px;
}

.figures.has-balance {
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr);
}

.figure.wide {
  grid-column: span 1;
}

@media (max-width: 1365px) {
  .figures.has-balance {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .figure.wide {
    grid-column: 1 / -1;
  }
}

.label {
  color: #64748b;
}

.value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.unit {
  margin-left: 4px;
  font-size: 14px;
  font-weight: 400;
  color: #64748b;
}

.note {
  margin-top: auto;
  padding-top: 8px;
  color: #64748b;
  font-size: 12px;
}

.balance-line {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  margin-top: 8px;
}

.balance-line .small {
  color: #64748b;
  font-size: 12px;
}

.balance-line .num {
  font-size: 22px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.balance-line .strong {
  font-weight: 600;
}

.op {
  font-size: 20px;
  color: #64748b;
  padding-bottom: 2px;
}

.block {
  border-radius: 12px;
  margin-bottom: 12px;
}

.count {
  margin-left: 6px;
  color: #64748b;
  font-size: 12px;
}

.sub {
  color: #64748b;
  font-size: 12px;
}

.strong {
  font-weight: 600;
}

.muted {
  color: #64748b;
}

.tag {
  margin-left: 4px;
}

.hint {
  margin: 12px 0 0;
  color: #64748b;
  font-size: 12px;
}

.check {
  margin: 16px 0 12px;
}

.total :deep(td) {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
