<template>
  <div>
    <a-breadcrumb class="crumb">
      <a-breadcrumb-item><router-link :to="{ name: 'members' }">会员查询</router-link></a-breadcrumb-item>
      <a-breadcrumb-item>会员详情</a-breadcrumb-item>
    </a-breadcrumb>
    <a-skeleton v-if="loading && !member" active />
    <a-result v-else-if="loadError" status="warning" :title="loadError">
      <template #extra><a-button @click="router.push({ name: 'members' })">返回会员查询</a-button></template>
    </a-result>
    <template v-else-if="member">
      <MemberCardPanel :member="member" full-phone>
        <template v-if="member.hasCard && member.status === 'ACTIVE'">
          <a-button type="primary" @click="router.push({ name: 'recharge', query: { memberId: member.id } })">充值</a-button>
          <a-button @click="router.push({ name: 'consume', query: { memberId: member.id } })">扣款</a-button>
          <a-button @click="router.push({ name: 'sign-flows', query: { memberId: member.id, start: '1' } })">
            发起权益单
          </a-button>
        </template>
        <a-button
          v-else-if="!member.hasCard"
          type="primary"
          @click="router.push({ name: 'member-open', query: { phone: member.phone } })"
        >
          开卡
        </a-button>
      </MemberCardPanel>
      <div class="facts">
        <span>小程序：{{ member.wechatBound ? '会员已登录过' : '会员还没登录过' }}</span>
        <span>登记时间：{{ formatDateTime(member.createdAt) }}</span>
      </div>

      <a-card :bordered="false" class="block" title="流水">
        <template #extra>
          <span v-if="!session.superAdmin" class="muted">只显示在你的门店发生的流水；余额是全公司总余额</span>
        </template>
        <LedgerTable
          :entries="entries"
          :loading="ledgerLoading"
          :total="total"
          :page="page"
          :page-size="pageSize"
          :show-member="false"
          empty-text="还没有流水"
          @page="onPage"
          @detail="showDetail"
          @reverse="startReverse"
        />
      </a-card>
    </template>

    <LedgerDetailDrawer :open="!!detail" :entry="detail" @close="detail = null" @reverse="startReverse" @jump="jump" />
    <ReversalModal :open="!!reversing" :entry="reversing" @close="reversing = null" @done="afterReverse" />
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '../../api/http';
import { getLedgerEntry, listLedger } from '../../api/ledger';
import { getMember } from '../../api/members';
import type { LedgerEntry, MemberCard } from '../../api/types';
import LedgerDetailDrawer from '../../components/LedgerDetailDrawer.vue';
import LedgerTable from '../../components/LedgerTable.vue';
import MemberCardPanel from '../../components/MemberCardPanel.vue';
import ReversalModal from '../../components/ReversalModal.vue';
import { useSessionStore } from '../../stores/session';
import { formatDateTime } from '../../utils/datetime';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const member = ref<MemberCard | null>(null);
const loading = ref(false);
const loadError = ref('');
const entries = ref<LedgerEntry[]>([]);
const ledgerLoading = ref(false);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const detail = ref<LedgerEntry | null>(null);
const reversing = ref<LedgerEntry | null>(null);

function memberId(): string {
  return String(route.params.id);
}

async function loadMember(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    member.value = await getMember(memberId());
  } catch (e) {
    loadError.value = errorMessage(e, '没有找到这位会员');
  } finally {
    loading.value = false;
  }
}

async function loadLedger(): Promise<void> {
  ledgerLoading.value = true;
  try {
    const result = await listLedger({ memberId: memberId(), page: page.value, pageSize: pageSize.value });
    entries.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    ledgerLoading.value = false;
  }
}

function onPage(p: number, size: number): void {
  page.value = p;
  pageSize.value = size;
  void loadLedger();
}

function showDetail(entry: LedgerEntry): void {
  detail.value = entry;
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
  await Promise.all([loadMember(), loadLedger()]);
}

watch(
  () => route.params.id,
  (id) => {
    if (id) {
      page.value = 1;
      void loadMember();
      void loadLedger();
    }
  },
);

onMounted(() => {
  void loadMember();
  void loadLedger();
});
</script>

<style scoped>
.crumb {
  margin-bottom: 16px;
}

.facts {
  display: flex;
  gap: 24px;
  margin: 12px 4px;
  color: #64748b;
  font-size: 12px;
}

.block {
  border-radius: 12px;
}

.muted {
  color: #64748b;
  font-size: 12px;
}
</style>
