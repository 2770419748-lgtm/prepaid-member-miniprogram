<template>
  <div>
    <h1 class="pm-page-title">门店管理</h1>
    <p class="pm-page-sub">
      门店的地址、电话和营业时间会显示在小程序会员页的「可用门店」里，供会员导航和拨号。
      <template v-if="session.superAdmin">门店多的话，点「批量导入」一次传一张 Excel 表。</template>
      <template v-else-if="session.managed.length > 0">店长可以改自己店的资料，不能停用门店。</template>
    </p>
    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-radio-group v-model:value="status" button-style="solid" @change="reload(1)">
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button value="ACTIVE">营业中</a-radio-button>
          <a-radio-button value="DISABLED">已停用</a-radio-button>
        </a-radio-group>
        <span class="pm-spacer" />
        <a-space v-if="session.superAdmin" wrap>
          <a-button :loading="downloading" @click="downloadSheet">下载门店表格</a-button>
          <a-button @click="importOpen = true">批量导入</a-button>
          <a-button type="primary" @click="openCreate">新建门店</a-button>
        </a-space>
      </div>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        :scroll="{ x: 960 }"
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
            <span :class="{ muted: !record.address }" :title="record.address || undefined">{{ record.address || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'phone'">
            <span class="nowrap" :class="{ muted: !record.phone }">{{ record.phone || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'hours'">
            <span :class="{ muted: !record.businessHours }">{{ record.businessHours || '未填写' }}</span>
          </template>
          <template v-else-if="column.key === 'location'">
            <a-tooltip v-if="record.lat !== null" :title="`纬度 ${record.lat}，经度 ${record.lng}`">
              <span class="nowrap located">已设置</span>
            </a-tooltip>
            <span v-else class="muted nowrap">未设置</span>
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
        <a-form-item label="地图坐标" :validate-status="coordHint.error ? 'error' : ''" :help="coordHint.text || undefined">
          <a-input v-model:value="form.coords" :maxlength="60" allow-clear placeholder="例如 30.657180,104.080810" />
          <template #extra>
            在 <a :href="COORDINATE_PICKER_URL" target="_blank" rel="noopener noreferrer">腾讯坐标拾取器</a>
            搜到门店、点一下，把两个数整段复制过来就行，高德的也可以，先后不用管。不填则会员端不能导航。
          </template>
        </a-form-item>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>

    <StoreImportModal
      :open="importOpen"
      :downloading="downloading"
      @close="importOpen = false"
      @download="downloadSheet"
      @done="onImported"
    />
  </div>
</template>

<script setup lang="ts">
import { message, Modal, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import dayjs from 'dayjs';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '../../api/http';
import { createStore, listAllStores, listStores, updateStore, type StoreForm } from '../../api/org';
import type { ActiveStatus, StoreView } from '../../api/types';
import { useSessionStore } from '../../stores/session';
import { downloadBytes } from '../../utils/download';
import { COORDINATE_PICKER_URL, formatCoordinates, parseCoordinates, storeSheetFile } from '../../utils/store-import';
import StoreImportModal from './StoreImportModal.vue';

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
  /** 坐标整段粘贴，例如「30.657180,104.080810」，先后都认。 */
  coords: '',
});

const importOpen = ref(false);
const downloading = ref(false);

/** 坐标框下面的提示：认出来了就写清纬度、经度，看不懂就说为什么。 */
const coordHint = computed<{ text: string; error: boolean }>(() => {
  const parsed = parseCoordinates(form.coords);
  if (!parsed.ok) {
    return { text: parsed.message, error: true };
  }
  if (!parsed.value) {
    return { text: '', error: false };
  }
  return { text: `认出来了：纬度 ${parsed.value.lat.toFixed(6)}，经度 ${parsed.value.lng.toFixed(6)}`, error: false };
});

// 1280 宽的笔记本上不用左右滚：坐标只显示有没有设置，具体数字放在提示里。
const columns: ColumnsType<StoreView> = [
  { title: '门店', key: 'name', width: 160 },
  { title: '状态', key: 'status', width: 84 },
  // 地址不给固定宽度，吃掉剩下的空间；表格最小宽度里给它留了约 180px。
  { title: '地址', key: 'address', ellipsis: true },
  { title: '电话', key: 'phone', width: 130 },
  { title: '营业时间', key: 'hours', width: 150 },
  { title: '导航坐标', key: 'location', width: 90 },
  { title: '操作', key: 'actions', width: 170, fixed: 'right' },
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
  form.coords = store ? formatCoordinates(store.lat, store.lng) : '';
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
  const coords = parseCoordinates(form.coords);
  if (!coords.ok) {
    formError.value = `地图坐标：${coords.message}`;
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
      await updateStore(editing.value.id, { ...body, lat: coords.value?.lat ?? null, lng: coords.value?.lng ?? null });
      message.success('门店资料已保存');
    } else {
      await createStore({
        ...body,
        name: body.name ?? '',
        ...(coords.value ? { lat: coords.value.lat, lng: coords.value.lng } : {}),
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
      ? '停用后这家店不能开卡、不能记账，小程序的会员页也不再显示它。会员的余额不受影响，可以去其他门店用。'
      : '恢复后这家店可以正常开卡、记账，并重新出现在小程序的会员页里。',
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

/** 下载门店表格：现有门店（含已停用的）都列上，改完传回「批量导入」。 */
async function downloadSheet(): Promise<void> {
  downloading.value = true;
  try {
    // 按建店先后排，和小程序会员看到的顺序一样。
    const stores = await listAllStores();
    downloadBytes(`门店清单-${dayjs().format('YYYYMMDD')}.xlsx`, storeSheetFile(stores));
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    downloading.value = false;
  }
}

async function onImported(): Promise<void> {
  importOpen.value = false;
  await Promise.all([reload(1), session.refreshStores()]);
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

.located {
  color: #16a34a;
  cursor: default;
}
</style>
