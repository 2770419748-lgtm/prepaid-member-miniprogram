<template>
  <a-modal
    :open="open"
    title="批量导入门店"
    width="1160px"
    :mask-closable="false"
    :keyboard="!importing"
    :closable="!importing"
    @cancel="close"
  >
    <template v-if="!result">
      <ol class="how">
        <li>
          先点<a-button type="link" size="small" class="inline-link" :loading="downloading" @click="emit('download')">下载门店表格</a-button>，后台已有的门店都列在里面。一行一家店，门店名称必填，地址、电话、营业时间、坐标有就填。
        </li>
        <li>
          坐标在
          <a :href="COORDINATE_PICKER_URL" target="_blank" rel="noopener noreferrer">腾讯坐标拾取器</a>
          里取：搜到门店、点一下，把两个数复制到「坐标」那格，高德地图的也行。不要用百度地图的坐标，会偏几百米。
        </li>
        <li>和后台同名的门店会补上表里填的资料，名字不一样的会新建；空格子不会清掉已有的资料。导入前会先列出来给你看。</li>
      </ol>
      <a-upload-dragger
        accept=".xlsx,.csv"
        :multiple="false"
        :show-upload-list="false"
        :before-upload="onPick"
        :disabled="checking"
      >
        <a-spin :spinning="checking">
          <p class="drop-title">{{ fileName ? `重新选文件（刚才是：${fileName}）` : '点这里选门店表格，或把文件拖进来' }}</p>
          <p class="drop-sub">Excel 表格（.xlsx）或 CSV，一次最多 {{ STORE_IMPORT_MAX_ROWS }} 家</p>
        </a-spin>
      </a-upload-dragger>
      <a-alert v-if="fileError" class="gap" type="error" show-icon :message="fileError" />
      <a-alert
        v-if="problems.length > 0"
        class="gap"
        type="error"
        show-icon
        :message="`表格里有 ${problems.length} 处要改，改好保存后重新选文件，这次一家都没导入`"
      >
        <template #description>
          <ul class="problems">
            <li v-for="(p, i) in problems" :key="i">第 {{ p.line }} 行：{{ p.message }}</li>
          </ul>
        </template>
      </a-alert>
    </template>

    <template v-else>
      <a-alert v-if="result.errors > 0" type="error" show-icon :message="`有 ${result.errors} 行要先改好，改好保存后重新选文件`" />
      <a-alert v-else-if="toWrite === 0" type="info" show-icon message="表里填的资料后台都已经有了，不用导入" />
      <a-alert v-else type="info" show-icon :message="summary" description="下面是每一行会怎么处理，看一遍没问题再点「确认导入」。" />
      <a-table
        class="gap"
        size="small"
        :columns="columns"
        :data-source="previewRows"
        :pagination="false"
        row-key="key"
        :scroll="{ x: 1116, y: 380 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag :color="ACTION[record.action as StoreImportAction].color">{{ ACTION[record.action as StoreImportAction].label }}</a-tag>
          </template>
          <template v-else-if="column.key === 'name'">
            <span class="name">{{ record.name }}</span>
          </template>
          <template v-else-if="FIELD_KEYS.includes(column.key as string)">
            <span
              :title="record[column.key as string] || undefined"
              :class="{
                muted: !record[column.key as string],
                changed: record.changes.includes(column.key === 'coords' ? 'location' : column.key),
                nowrap: column.key === 'coords' || column.key === 'phone',
              }"
              >{{ record[column.key as string] || '—' }}</span
            >
          </template>
          <template v-else-if="column.key === 'note'">
            <span :class="{ error: record.action === 'ERROR' }">{{ record.note }}</span>
          </template>
        </template>
      </a-table>
      <a-alert v-if="submitError" class="gap" type="error" show-icon :message="submitError" />
    </template>

    <template #footer>
      <a-space>
        <a-button v-if="result" :disabled="importing" @click="reset">重新选文件</a-button>
        <a-button :disabled="importing" @click="close">取消</a-button>
        <a-button
          v-if="result"
          type="primary"
          :loading="importing"
          :disabled="result.errors > 0 || toWrite === 0"
          @click="confirm"
        >
          确认导入
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, ref, watch } from 'vue';
import { errorMessage } from '../../api/http';
import { importStores, type StoreImportAction, type StoreImportField, type StoreImportResult } from '../../api/org';
import {
  COORDINATE_PICKER_URL,
  formatCoordinates,
  parseStoreSheet,
  readStoreFile,
  SheetFileError,
  STORE_IMPORT_MAX_ROWS,
  type SheetProblem,
  type SheetRow,
} from '../../utils/store-import';

const props = defineProps<{ open: boolean; downloading?: boolean }>();
const emit = defineEmits<{ close: []; done: []; download: [] }>();

const ACTION: Record<StoreImportAction, { label: string; color: string }> = {
  CREATE: { label: '新建', color: 'blue' },
  UPDATE: { label: '补全资料', color: 'orange' },
  UNCHANGED: { label: '没有变化', color: 'default' },
  ERROR: { label: '要改', color: 'red' },
};

const FIELD_LABEL: Record<StoreImportField, string> = {
  address: '地址',
  phone: '电话',
  businessHours: '营业时间',
  location: '坐标',
};

const FIELD_KEYS = ['address', 'phone', 'businessHours', 'coords'];

const fileName = ref('');
const fileError = ref('');
const problems = ref<SheetProblem[]>([]);
const rows = ref<SheetRow[]>([]);
const result = ref<StoreImportResult | null>(null);
const checking = ref(false);
const importing = ref(false);
const submitError = ref('');

// 1160 宽的弹窗里不用左右滚；地址不给宽度，吃掉剩下的空间（至少约 220px）。
const columns: ColumnsType = [
  { title: '行', dataIndex: 'line', key: 'line', width: 50 },
  { title: '门店名称', key: 'name', width: 150 },
  { title: '怎么处理', key: 'action', width: 96 },
  { title: '地址', key: 'address', ellipsis: true },
  { title: '电话', key: 'phone', width: 120 },
  { title: '营业时间', key: 'businessHours', width: 140 },
  { title: '坐标', key: 'coords', width: 186 },
  { title: '说明', key: 'note', width: 158 },
];

const toWrite = computed(() => (result.value ? result.value.created + result.value.updated : 0));

const summary = computed(() => {
  const r = result.value;
  if (!r) {
    return '';
  }
  const parts = [];
  if (r.created > 0) {
    parts.push(`新建 ${r.created} 家`);
  }
  if (r.updated > 0) {
    parts.push(`给 ${r.updated} 家已有门店补全资料`);
  }
  const rest = r.unchanged > 0 ? `，另有 ${r.unchanged} 家和后台一样不用动` : '';
  return `「${fileName.value}」里共 ${r.items.length} 家门店：将${parts.join('、')}${rest}`;
});

const previewRows = computed(() => {
  const r = result.value;
  if (!r) {
    return [];
  }
  return r.items.map((item) => {
    const sheet = rows.value[item.index];
    const row = sheet?.row;
    let note = '';
    if (item.action === 'ERROR') {
      note = item.error ?? '';
    } else if (item.action === 'CREATE') {
      note = '导入后就是营业中';
    } else if (item.action === 'UPDATE') {
      note = `会改：${item.changes.map((c) => FIELD_LABEL[c]).join('、')}`;
    } else {
      note = '填的和后台一样';
    }
    if (item.storeDisabled) {
      note += '（这家店已停用，只改资料，不恢复营业）';
    }
    return {
      key: item.index,
      line: sheet?.line ?? '',
      name: item.name,
      action: item.action,
      changes: item.changes,
      address: row?.address ?? '',
      phone: row?.phone ?? '',
      businessHours: row?.businessHours ?? '',
      coords: row?.lat !== undefined && row?.lng !== undefined ? formatCoordinates(row.lat, row.lng) : '',
      note,
    };
  });
});

function reset(): void {
  fileName.value = '';
  fileError.value = '';
  problems.value = [];
  rows.value = [];
  result.value = null;
  submitError.value = '';
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset();
    }
  },
);

function close(): void {
  if (!importing.value) {
    emit('close');
  }
}

/** 不走组件自带的上传：返回 false 拦下，自己读文件。 */
function onPick(file: File): false {
  void check(file);
  return false;
}

async function check(file: File): Promise<void> {
  reset();
  fileName.value = file.name;
  checking.value = true;
  try {
    const table = readStoreFile(file.name, new Uint8Array(await file.arrayBuffer()));
    const parsed = parseStoreSheet(table);
    if (parsed.problems.length > 0) {
      problems.value = parsed.problems;
      return;
    }
    rows.value = parsed.rows;
    result.value = await importStores({ dryRun: true, rows: parsed.rows.map((r) => r.row) });
  } catch (e) {
    fileError.value = e instanceof SheetFileError ? e.message : errorMessage(e);
  } finally {
    checking.value = false;
  }
}

async function confirm(): Promise<void> {
  importing.value = true;
  submitError.value = '';
  try {
    const done = await importStores({ dryRun: false, rows: rows.value.map((r) => r.row) });
    const parts = [];
    if (done.created > 0) {
      parts.push(`新建 ${done.created} 家`);
    }
    if (done.updated > 0) {
      parts.push(`补全 ${done.updated} 家`);
    }
    message.success(`门店导入好了：${parts.join('，') || '没有变化'}`);
    emit('done');
  } catch (e) {
    submitError.value = `${errorMessage(e)}。可以点「重新选文件」再核对一遍`;
  } finally {
    importing.value = false;
  }
}
</script>

<style scoped>
.how {
  margin: 0 0 16px;
  padding-left: 20px;
  color: #475569;
  line-height: 1.9;
}

.inline-link {
  padding: 0 2px;
  height: auto;
}

.drop-title {
  margin: 8px 0 4px;
  font-size: 15px;
  color: #0f172a;
}

.drop-sub {
  margin: 0 0 8px;
  color: #94a3b8;
}

.gap {
  margin-top: 12px;
}

.problems {
  margin: 4px 0 0;
  padding-left: 18px;
  max-height: 220px;
  overflow: auto;
}

.name {
  font-weight: 500;
}

.muted {
  color: #cbd5e1;
}

.changed {
  color: #1677ff;
  font-weight: 500;
}

.error {
  color: #dc2626;
}

.nowrap {
  white-space: nowrap;
}
</style>
