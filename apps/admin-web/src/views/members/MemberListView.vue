<template>
  <div>
    <h1 class="pm-page-title">会员查询</h1>
    <div class="pm-toolbar">
      <a-input-search
        v-model:value="search"
        placeholder="完整手机号，或手机号后几位、称呼"
        enter-button="查询"
        allow-clear
        style="width: 360px"
        @search="reload(1)"
      />
      <span class="pm-spacer" />
      <a-button type="primary" @click="router.push({ name: 'member-open' })">开卡</a-button>
    </div>
    <a-alert v-if="!session.superAdmin" class="scope" type="info" show-icon>
      <template #message>
        这里列出在本店开卡或在本店消费过的会员。别的门店开卡的会员，输入完整手机号也能查到并记账。
      </template>
    </a-alert>
    <a-card :bordered="false" class="block">
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        :scroll="{ x: 900 }"
        @change="onTableChange"
      >
        <template #emptyText>
          <a-empty :description="search ? '没有符合条件的会员' : '还没有会员，先去开卡'" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <router-link :to="{ name: 'member-detail', params: { id: record.id } }">
              {{ record.name || '未填称呼' }}
            </router-link>
          </template>
          <template v-else-if="column.key === 'phone'">{{ maskPhone(record.phone) }}</template>
          <template v-else-if="column.key === 'balance'">
            <MoneyText v-if="record.balanceCent !== null" :cent="record.balanceCent" />
            <span v-else class="muted">—</span>
          </template>
          <template v-else-if="column.key === 'openedAt'">{{ formatDate(record.openedAt) }}</template>
          <template v-else-if="column.key === 'status'">
            <a-tag v-if="record.status === 'DISABLED'" color="error">已停用</a-tag>
            <a-tag v-else-if="!record.hasCard" color="warning">未开卡</a-tag>
            <a-tag v-else color="success">正常</a-tag>
          </template>
          <template v-else-if="column.key === 'wechat'">
            <span :class="record.wechatBound ? '' : 'muted'">{{ record.wechatBound ? '已登录' : '未登录' }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space :size="4">
              <a-button type="link" size="small" @click="router.push({ name: 'member-detail', params: { id: record.id } })">
                详情
              </a-button>
              <template v-if="record.hasCard && record.status === 'ACTIVE'">
                <a-button type="link" size="small" @click="router.push({ name: 'recharge', query: { memberId: record.id } })">
                  充值
                </a-button>
              </template>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { message, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../../api/http';
import { listMembers } from '../../api/members';
import type { MemberCard } from '../../api/types';
import MoneyText from '../../components/MoneyText.vue';
import { useSessionStore } from '../../stores/session';
import { formatDate } from '../../utils/datetime';
import { isMobile, maskPhone, normalizePhone } from '../../utils/phone';

const router = useRouter();
const session = useSessionStore();

const search = ref('');
const rows = ref<MemberCard[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const columns: ColumnsType<MemberCard> = [
  { title: '会员', key: 'name', width: 140 },
  { title: '手机号', key: 'phone', width: 130 },
  { title: '余额（元）', key: 'balance', align: 'right', width: 130 },
  { title: '开卡门店', dataIndex: 'openStoreName', key: 'openStoreName', width: 120 },
  { title: '开卡日期', key: 'openedAt', width: 120 },
  { title: '状态', key: 'status', width: 90 },
  { title: '小程序', key: 'wechat', width: 90 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' },
];

const pagination = computed<TablePaginationConfig>(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  showTotal: (n: number) => `共 ${n} 位`,
}));

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  loading.value = true;
  const text = search.value.trim();
  const query = isMobile(text)
    ? { phone: normalizePhone(text) }
    : text
      ? { keyword: text }
      : {};
  try {
    const result = await listMembers({ ...query, page: page.value, pageSize: pageSize.value });
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

function onTableChange(p: TablePaginationConfig): void {
  pageSize.value = p.pageSize ?? pageSize.value;
  void reload(p.current ?? 1);
}

onMounted(() => reload(1));
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.scope {
  margin-bottom: 12px;
}

.muted {
  color: #64748b;
}
</style>
