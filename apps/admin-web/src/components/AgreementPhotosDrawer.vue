<template>
  <a-drawer :open="!!flow" title="纸质协议单" :width="560" @close="emit('close')">
    <template v-if="flow">
      <a-descriptions :column="1" size="small" class="info">
        <a-descriptions-item label="会员">
          {{ flow.member.name || '未填称呼' }} · {{ maskPhone(flow.member.phone) }}
        </a-descriptions-item>
        <a-descriptions-item label="权益方案">{{ flow.benefitPlan?.title ?? '未选方案' }}</a-descriptions-item>
        <a-descriptions-item v-if="flow.rechargeAmountCent != null" label="会员权益金额">
          <span class="pm-num">{{ formatCent(flow.rechargeAmountCent) }} 元</span>
          <span class="muted"> · {{ rechargeText(flow) }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="开单门店">{{ flow.store?.name ?? '—' }}</a-descriptions-item>
        <a-descriptions-item label="上传人">{{ flow.initiator?.name ?? '—' }}</a-descriptions-item>
        <a-descriptions-item label="上传时间">
          <span class="pm-num">{{ formatDateTime(flow.signedAt ?? flow.createdAt) }}</span>
        </a-descriptions-item>
      </a-descriptions>

      <div class="photos-head">
        <span class="photos-title">协议单照片（{{ flow.photos.length }} 张）</span>
        <span class="spacer" />
        <a-button size="small" :loading="uploading" :disabled="room <= 0" @click="pick">补传照片</a-button>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onPicked" />
      </div>
      <p class="muted hint">
        照片上有顾客的姓名、电话和签字，只有会员本人、开单门店的员工和超级管理员能看到。点照片可以放大。
        <template v-if="room <= 0">已经有 {{ maxPhotos }} 张了，不能再补传。</template>
      </p>
      <a-alert v-if="loadError" type="warning" show-icon class="gap" :message="loadError">
        <template #action><a-button size="small" @click="loadPhotos">重试</a-button></template>
      </a-alert>
      <a-image-preview-group>
        <div class="grid">
          <div v-for="photo in flow.photos" :key="photo.id" class="cell">
            <a-image v-if="urls[photo.id]" :src="urls[photo.id]" :width="150" :height="200" class="photo" />
            <div v-else class="photo placeholder"><a-spin size="small" /></div>
            <div class="cell-foot">
              <span class="muted pm-num">{{ formatDateTime(photo.createdAt) }}</span>
              <a-button
                v-if="canRemove && flow.photos.length > 1"
                type="link"
                size="small"
                danger
                @click="startRemove(photo.id)"
              >
                删除
              </a-button>
            </div>
          </div>
        </div>
      </a-image-preview-group>
    </template>

    <a-modal
      :open="!!removing"
      title="删除这张照片？"
      ok-text="确认删除"
      cancel-text="取消"
      :ok-button-props="{ danger: true, loading: removeBusy, disabled: !removeReason.trim() }"
      @ok="submitRemove"
      @cancel="removing = null"
    >
      <p class="muted">删除后会员和门店都看不到这张照片，操作记录里会留下谁、什么时候、为什么删的。协议单至少要留一张照片。</p>
      <a-textarea v-model:value="removeReason" :rows="2" :maxlength="100" placeholder="删除原因，例如：拍错了，不是这位顾客的协议单" />
    </a-modal>
  </a-drawer>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  addAgreementPhotos,
  fetchAgreementPhoto,
  removeAgreementPhoto,
  uploadAgreementPhoto,
  type SignFlow,
} from '../api/esign';
import { errorMessage } from '../api/http';
import { useSessionStore } from '../stores/session';
import { formatDateTime } from '../utils/datetime';
import { rechargeText } from '../utils/esign';
import { formatCent } from '../utils/money';
import { maskPhone } from '../utils/phone';
import { compressPhoto } from '../utils/photo';

const props = withDefaults(defineProps<{ flow: SignFlow | null; maxPhotos?: number }>(), { maxPhotos: 9 });
const emit = defineEmits<{ close: []; updated: [flow: SignFlow] }>();

const session = useSessionStore();

/** 照片 id → 浏览器里的临时地址。换协议单或关掉时释放。 */
const urls = ref<Record<string, string>>({});
const loadError = ref('');

const room = computed(() => (props.flow ? props.maxPhotos - props.flow.photos.length : 0));
/** 和服务端一致：超级管理员或开单门店的店长才能删。 */
const canRemove = computed(
  () => !!props.flow && (session.superAdmin || (!!props.flow.store && session.canManage(props.flow.store.id))),
);

function releaseAll(): void {
  for (const url of Object.values(urls.value)) {
    URL.revokeObjectURL(url);
  }
  urls.value = {};
}

async function loadPhotos(): Promise<void> {
  const flow = props.flow;
  if (!flow) {
    return;
  }
  loadError.value = '';
  const missing = flow.photos.filter((photo) => !urls.value[photo.id]);
  const results = await Promise.allSettled(missing.map((photo) => fetchAgreementPhoto(flow.id, photo.id)));
  if (props.flow?.id !== flow.id) {
    return;
  }
  const next = { ...urls.value };
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      next[missing[index].id] = URL.createObjectURL(result.value);
    }
  });
  urls.value = next;
  if (results.some((result) => result.status === 'rejected')) {
    loadError.value = '有照片没加载出来，请检查网络后重试';
  }
}

watch(
  () => props.flow?.id,
  () => {
    releaseAll();
    void loadPhotos();
  },
  { immediate: true },
);

// 补传、删除后照片列表变了：新的补加载，删掉的释放。
watch(
  () => props.flow?.photos.map((photo) => photo.id).join(','),
  () => {
    const keep = new Set(props.flow?.photos.map((photo) => photo.id) ?? []);
    const next: Record<string, string> = {};
    for (const [id, url] of Object.entries(urls.value)) {
      if (keep.has(id)) {
        next[id] = url;
      } else {
        URL.revokeObjectURL(url);
      }
    }
    urls.value = next;
    void loadPhotos();
  },
);

onBeforeUnmount(releaseAll);

// 补传
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

function pick(): void {
  fileInput.value?.click();
}

async function onPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  const flow = props.flow;
  if (!flow || files.length === 0) {
    return;
  }
  if (files.length > room.value) {
    message.warning(`最多还能补传 ${room.value} 张`);
    return;
  }
  uploading.value = true;
  try {
    const photoIds: string[] = [];
    for (const file of files) {
      const photo = await compressPhoto(file);
      if (!photo) {
        message.error(`「${file.name}」打不开，请换成 JPG 或 PNG 格式的照片`);
        return;
      }
      photoIds.push((await uploadAgreementPhoto(photo, 'agreement.jpg')).id);
    }
    const updated = await addAgreementPhotos(flow.id, photoIds);
    message.success(`已补传 ${photoIds.length} 张`);
    emit('updated', updated);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    uploading.value = false;
  }
}

// 删除
const removing = ref<string | null>(null);
const removeReason = ref('');
const removeBusy = ref(false);

function startRemove(photoId: string): void {
  removing.value = photoId;
  removeReason.value = '';
}

async function submitRemove(): Promise<void> {
  const flow = props.flow;
  if (!flow || !removing.value) {
    return;
  }
  removeBusy.value = true;
  try {
    const updated = await removeAgreementPhoto(flow.id, removing.value, removeReason.value.trim());
    message.success('已删除');
    removing.value = null;
    emit('updated', updated);
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    removeBusy.value = false;
  }
}
</script>

<style scoped>
.info {
  margin-bottom: 16px;
}

.muted {
  color: #64748b;
  font-size: 12px;
}

.photos-head {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.photos-title {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.hint {
  margin: 0 0 12px;
  line-height: 1.6;
}

.gap {
  margin-bottom: 12px;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.cell {
  width: 150px;
}

.photo,
.cell :deep(.ant-image-img) {
  width: 150px;
  height: 200px;
  object-fit: cover;
  border-radius: 8px;
  background: #f1f5f9;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}

.cell-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  min-height: 24px;
  white-space: nowrap;
}

.cell-foot :deep(.ant-btn) {
  padding: 0 0 0 4px;
}
</style>
