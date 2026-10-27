<template>
  <div class="qr">
    <template v-if="flow.signUrl">
      <a-qrcode :value="flow.signUrl" :size="200" color="#0F172A" />
      <p class="hint">请会员用微信扫码阅读并签署。会员也可以打开会员小程序，在首页完成签署。</p>
      <a-input-group compact class="link">
        <a-input :value="flow.signUrl" readonly style="width: calc(100% - 88px)" />
        <a-button style="width: 88px" @click="copy">复制链接</a-button>
      </a-input-group>
      <a-tag v-if="flow.env === 'SANDBOX'" class="env">测试签署</a-tag>
    </template>
    <a-empty v-else description="这份签署已经结束，没有签署码了" />
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { SignFlow } from '../api/esign';

const props = defineProps<{ flow: SignFlow }>();

async function copy(): Promise<void> {
  if (!props.flow.signUrl) {
    return;
  }
  try {
    await navigator.clipboard.writeText(props.flow.signUrl);
    message.success('签署链接已复制');
  } catch {
    message.warning('浏览器不允许自动复制，请手动选中链接复制');
  }
}
</script>

<style scoped>
.qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.hint {
  margin: 0;
  color: #64748b;
  text-align: center;
}

.link {
  display: flex;
  width: 100%;
}

.env {
  margin: 0;
}
</style>
