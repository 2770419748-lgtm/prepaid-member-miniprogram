<template>
  <span :class="cls">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatChange, formatCent } from '../utils/money';

/** signed：显示 +/- 和加减色（加为成功色，减为危险色）。否则只显示金额。 */
const props = defineProps<{ cent: number; signed?: boolean }>();

const text = computed(() => (props.signed ? formatChange(props.cent) : formatCent(props.cent)));
const cls = computed(() => {
  if (!props.signed || props.cent === 0) {
    return 'pm-num';
  }
  return props.cent > 0 ? 'pm-amount-plus' : 'pm-amount-minus';
});
</script>
