<template>
  <a-tag :color="meta.color" class="tag">{{ meta.label }}</a-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LedgerType } from '../api/types';

const props = defineProps<{ type: LedgerType }>();

const META: Record<LedgerType, { label: string; color: string }> = {
  RECHARGE: { label: '充值', color: 'success' },
  CONSUME: { label: '消费', color: 'processing' },
  REVERSAL: { label: '冲正', color: 'warning' },
};

const meta = computed(() => META[props.type]);
</script>

<style scoped>
.tag {
  margin: 0;
}
</style>
