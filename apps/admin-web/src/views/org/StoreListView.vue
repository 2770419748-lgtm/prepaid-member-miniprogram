<template>
  <div>
    <h1 class="pm-page-title">门店管理</h1>
    <p class="pm-page-sub">
      门店的地址、电话和营业时间会显示在会员小程序的「可用门店」里，供会员导航和拨号。
      <template v-if="!session.superAdmin && session.managed.length > 0">店长可以改自己店的资料，不能停用门店。</template>
    </p>
    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-radio-group v-model:value="status" button-style="solid" @change="reload(1)">
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button value="ACTIVE">营业中</a-radio-button>
          <a-radio-button value="DISABLED">已停用</a-radio-button>
        </a-radio-group>
        <span class="pm-spacer" />
        <a-button v-if="session.superAdmin" type="primary" @click="openCreate">新建门店</a-button>
      </div>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        :scroll="{ x: 980 }"
        @change="onTableChange"
      >
        <template #emptyText><a-empty description="还没有门店" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="name">{{ record.name }}</span>
            <a-tag v-if="record.id === session.currentStoreId" color="blue" class="here">当前</a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.status === 'ACTIVE' ? 'success' : 'default'">
              {{ record.status === 'ACTIVE' ? '营业中' : '已停用' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'address'">
            <span :class="{ muted: !record.address }">{{ record.address || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'phone'">
            <span :class="{ muted: !record.phone }">{{ record.phone || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'hours'">
            <span :class="{ muted: !record.businessHours }">{{ record.businessHours || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'location'">
            <span v-if="record.lat !== null" class="pm-num nowrap">{{ record.lat }}, {{ record.lng }}</span>
            <span v-else class="muted">未设置</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space :size="4">
              <a-button v-if="session.canManage(record.id)" type="link" size="small" @click="openEdit(record)">编辑</a-button>
              <a-button
                v-if="session.atLeast('STORE_MANAGER') && session.canManage(record.id)"
                type="link"
                size="small"
                @click="router.push({ name: 'staff', query: { storeId: record.id } })"
              >
                员工
              </a-button>
              <a-button
                v-if="session.superAdmin"
                type="link"
                size="small"
                :danger="record.status === 'ACTIVE'"
                @click="toggleStatus(record)"
              >
                {{ record.status === 'ACTIVE' ? '停用' : '恢复营业' }}
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      :open="formOpen"
      :title="editing ? `编辑门店：${editing.name}` : '新建门店'"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      :mask-closable="false"
      width="560px"
      @ok="save"
      @cancel="formOpen = false"
    >
      <a-form ref="formRef" layout="vertical" :model="form">
        <a-form-item label="门店名称" name="name" :rules="[{ required: true, whitespace: true, message: '请填写门店名称' }]">
          <a-input v-model:value="form.name" :maxlength="80" placeholder="例如：旗舰店" />
        </a-form-item>
        <a-form-item label="详细地址" name="address">
          <a-input v-model:value="form.address" :maxlength="200" placeholder="会员导航用，写到门牌号" />
        </a-form-item>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="联系电话" name="phone">
              <a-input v-model:value="form.phone" :maxlength="30" placeholder="会员一键拨号" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="营业时间" name="businessHours">
              <a-input v-model:value="form.businessHours" :maxlength="200" placeholder="例如：每天 10:00-22:00" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="地图坐标" extra="可在地图软件里取点后填写，纬度和经度要一起填；不填则会员端不显示导航定位">
          <a-space>
            <a-input-number v-model:value="form.lat" :min="-90" :max="90" :precision="6" placeholder="纬度" style="width: 160px" />
            <a-input-number v-model:value="form.lng" :min="-180" :max="180" :precision="6" placeholder="经度" style="width: 160px" />
          </a-space>
        </a-form-item>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message, Modal, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../../api/http';
import { createStore, listStores, updateStore, type StoreForm } from '../../api/org';
import type { ActiveStatus, StoreView } from '../../api/types';
import { useSessionStore } from '../../stores/session';

const router = useRouter();
const session = useSessionStore();

const status = ref<'' | ActiveStatus>('');
const rows = ref<StoreView[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const formOpen = ref(false);
const editing = ref<StoreView | null>(null);
const saving = ref(false);
const formError = ref('');
const formRef = ref<{ validate: () => Promise<unknown> } | null>(null);
const form = reactive({
  name: '',
  address: '',
  phone: '',
  businessHours: '',
  lat: null as number | null,
  lng: null as number | null,
});

const columns: ColumnsType<StoreView> = [
  { title: '门店', key: 'name', width: 160 },
  { title: '状态', key: 'status', width: 90 },
  { title: '地址', key: 'address', ellipsis: true },
  { title: '电话', key: 'phone', width: 140 },
  { title: '营业时间', key: 'hours', width: 180 },
  { title: '坐标', key: 'location', width: 210 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' },
];

const pagination = computed<TablePaginationConfig>(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showTotal: (n: number) => `共 ${n} 家`,
}));

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  loading.value = true;
  try {
    const result = await listStores({ page: page.value, pageSize: pageSize.value, status: status.value || undefined });
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

function fill(store: StoreView | null): void {
  form.name = store?.name ?? '';
  form.address = store?.address ?? '';
  form.phone = store?.phone ?? '';
  form.businessHours = store?.businessHours ?? '';
  form.lat = store?.lat ?? null;
  form.lng = store?.lng ?? null;
}

function openCreate(): void {
  editing.value = null;
  fill(null);
  formError.value = '';
  formOpen.value = true;
}

function openEdit(store: StoreView): void {
  editing.value = store;
  fill(store);
  formError.value = '';
  formOpen.value = true;
}

async function save(): Promise<void> {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  const hasLat = form.lat !== null && form.lat !== undefined;
  const hasLng = form.lng !== null && form.lng !== undefined;
  if (hasLat !== hasLng) {
    formError.value = '纬度和经度要一起填，或者都不填';
    return;
  }
  const body: StoreForm = {
    name: form.name.trim(),
    address: form.address.trim(),
    phone: form.phone.trim(),
    businessHours: form.businessHours.trim(),
  };
  saving.value = true;
  formError.value = '';
  try {
    if (editing.value) {
      await updateStore(editing.value.id, { ...body, lat: hasLat ? form.lat : null, lng: hasLng ? form.lng : null });
      message.success('门店资料已保存');
    } else {
      await createStore({
        ...body,
        name: body.name ?? '',
        ...(hasLat ? { lat: form.lat, lng: form.lng } : {}),
      });
      message.success('门店已新建');
    }
    formOpen.value = false;
    await Promise.all([reload(), session.refreshStores()]);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function toggleStatus(store: StoreView): void {
  const disabling = store.status === 'ACTIVE';
  Modal.confirm({
    title: disabling ? `停用「${store.name}」？` : `恢复「${store.name}」营业？`,
    content: disabling
      ? '停用后这家店不能开卡、不能记账，会员小程序也不再显示它。会员的余额不受影响，可以去其他门店用。'
      : '恢复后这家店可以正常开卡、记账，并重新出现在会员小程序里。',
    okText: disabling ? '确认停用' : '确认恢复',
    okButtonProps: { danger: disabling },
    cancelText: '取消',
    async onOk() {
      try {
        await updateStore(store.id, { status: disabling ? 'DISABLED' : 'ACTIVE' });
        message.success(disabling ? '门店已停用' : '门店已恢复营业');
        await Promise.all([reload(), session.refreshStores()]);
      } catch (e) {
        message.error(errorMessage(e));
      }
    },
  });
}

onMounted(() => reload(1));
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.name {
  font-weight: 500;
}

.here {
  margin-left: 6px;
}

.muted {
  color: #94a3b8;
}

.nowrap {
  white-space: nowrap;
}
</style>
