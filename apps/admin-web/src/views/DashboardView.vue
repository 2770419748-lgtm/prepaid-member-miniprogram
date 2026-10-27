<template>
  <div>
    <div class="head">
      <div>
        <h1 class="pm-page-title">你好，{{ session.staff?.name }}</h1>
        <p class="pm-page-sub">
          {{ today }} · {{ scopeText }}
        </p>
      </div>
      <a-space wrap>
        <a-button type="primary" @click="router.push({ name: 'member-open' })"><PlusOutlined />开卡</a-button>
        <a-button @click="router.push({ name: 'recharge' })">充值记账</a-button>
      </a-space>
    </div>

    <a-alert
      v-if="overviewMissing"
      class="gap"
      type="info"
      show-icon
      message="经营数字还在准备中"
      description="统计接口上线后，这里会显示会员数、储值总额和今日充值、消费。记账功能不受影响。"
    />
    <a-alert v-else-if="overviewError" class="gap" type="warning" show-icon :message="overviewError" />

    <div class="stats">
      <div class="stat">
        <div class="label"><IdcardOutlined /> {{ overview?.scope === 'ORG' || session.superAdmin ? '会员数' : '本店开卡会员' }}</div>
        <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 1, width: '60%' }" />
        <template v-else>
          <div class="value">{{ overview ? overview.cardCount.toLocaleString('en-US') : '—' }}<span class="unit">位</span></div>
          <div class="note">已开卡</div>
        </template>
      </div>
      <div v-if="showBalance" class="stat">
        <div class="label"><WalletOutlined /> 储值总额</div>
        <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 1, width: '60%' }" />
        <template v-else>
          <div class="value">{{ overview?.totalBalanceCent != null ? formatCent(overview.totalBalanceCent) : '—' }}<span class="unit">元</span></div>
          <div class="note">全公司会员余额合计</div>
        </template>
      </div>
      <div class="stat">
        <div class="label"><RiseOutlined /> 今日充值</div>
        <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 1, width: '60%' }" />
        <template v-else>
          <div class="value">{{ overview ? formatCent(overview.today.netRechargeCent) : '—' }}<span class="unit">元</span></div>
          <div class="note">{{ overview ? `${overview.today.rechargeCount} 笔${reversalNote(overview.today.reversedRechargeCent)}` : '' }}</div>
        </template>
      </div>
      <div class="stat">
        <div class="label"><ShoppingOutlined /> 今日消费</div>
        <a-skeleton v-if="loading" active :title="false" :paragraph="{ rows: 1, width: '60%' }" />
        <template v-else>
          <div class="value">{{ overview ? formatCent(overview.today.netConsumeCent) : '—' }}<span class="unit">元</span></div>
          <div class="note">{{ overview ? `${overview.today.consumeCount} 笔${reversalNote(overview.today.reversedConsumeCent)}` : '' }}</div>
        </template>
      </div>
    </div>

    <a-card :bordered="false" class="block" title="最近流水">
      <template #extra><router-link :to="{ name: 'ledger' }">查看全部</router-link></template>
      <a-skeleton v-if="recentLoading" active :paragraph="{ rows: 3 }" />
      <a-empty v-else-if="recent.length === 0" description="今天还没有记账。会员到店充值或消费后，记录会出现在这里。">
        <a-button type="primary" @click="router.push({ name: 'member-open' })">给第一位会员开卡</a-button>
      </a-empty>
      <a-list v-else :data-source="recent" item-layout="horizontal">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <router-link :to="{ name: 'member-detail', params: { id: item.memberId } }">
                  {{ item.memberName || '未填称呼' }}
                </router-link>
                <span class="muted"> · {{ maskPhone(item.memberPhone) }}</span>
              </template>
              <template #description>
                {{ LEDGER_TYPE_LABEL[item.type as LedgerType] }} · {{ item.storeName }} · {{ formatDateTime(item.createdAt) }}
                <a-tag v-if="item.reversedById" class="reversed">已冲正</a-tag>
              </template>
            </a-list-item-meta>
            <MoneyText :cent="item.changeCent" signed class="amount" />
          </a-list-item>
        </template>
      </a-list>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { IdcardOutlined, PlusOutlined, RiseOutlined, ShoppingOutlined, WalletOutlined } from '@ant-design/icons-vue';
import dayjs from 'dayjs';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage, isNotFound } from '../api/http';
import { listLedger } from '../api/ledger';
import { fetchOverview, type Overview } from '../api/reconciliation';
import type { LedgerEntry, LedgerType } from '../api/types';
import MoneyText from '../components/MoneyText.vue';
import { useSessionStore } from '../stores/session';
import { formatDateTime } from '../utils/datetime';
import { LEDGER_TYPE_LABEL } from '../utils/ledger';
import { formatCent } from '../utils/money';
import { maskPhone } from '../utils/phone';

const router = useRouter();
const session = useSessionStore();

const overview = ref<Overview | null>(null);
const loading = ref(true);
const overviewMissing = ref(false);
const overviewError = ref('');
const recent = ref<LedgerEntry[]>([]);
const recentLoading = ref(true);

const today = dayjs().format('YYYY年M月D日 dddd');
const scopeText = computed(() =>
  session.superAdmin ? '数字按全公司统计' : '数字按你所在门店统计；会员余额全公司通用',
);
/** 储值总额只给超级管理员看。 */
const showBalance = computed(() => session.superAdmin);

function reversalNote(cent: number): string {
  return cent > 0 ? `，已扣除冲正 ${formatCent(cent)} 元` : '';
}

onMounted(async () => {
  try {
    overview.value = await fetchOverview();
  } catch (e) {
    if (isNotFound(e)) {
      overviewMissing.value = true;
    } else {
      overviewError.value = errorMessage(e, '经营数字暂时加载不出来，请稍后刷新');
    }
  } finally {
    loading.value = false;
  }
  try {
    recent.value = (await listLedger({ pageSize: 6 })).items;
  } catch {
    recent.value = [];
  } finally {
    recentLoading.value = false;
  }
});
</script>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 8px;
}

.gap {
  margin-bottom: 12px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.stat {
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  min-height: 132px;
}

.label {
  color: #64748b;
}

.value {
  margin-top: 12px;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.15;
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

.block {
  border-radius: 12px;
}

.muted {
  color: #64748b;
  font-weight: 400;
}

.amount {
  font-size: 16px;
  font-weight: 500;
}

.reversed {
  margin-left: 6px;
}
</style>
