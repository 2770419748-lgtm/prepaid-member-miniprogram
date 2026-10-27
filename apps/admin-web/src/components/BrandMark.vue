<template>
  <div class="brand" :class="{ large }">
    <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1677FF" />
      <rect x="7" y="10" width="18" height="12" rx="2.5" fill="none" stroke="#fff" stroke-width="2" />
      <path d="M7 14.5h18" stroke="#fff" stroke-width="2" />
      <circle cx="21" cy="18.5" r="1.4" fill="#fff" />
    </svg>
    <div class="words">
      <div class="name">储值会员</div>
      <div class="sub">商家后台</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ large?: boolean }>();
</script>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mark {
  width: 32px;
  height: 32px;
  flex: none;
}

.name {
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  color: #0f172a;
}

.sub {
  font-size: 12px;
  line-height: 16px;
  color: #64748b;
}

.large .mark {
  width: 44px;
  height: 44px;
}

.large .name {
  font-size: 20px;
  line-height: 26px;
}

.large .sub {
  font-size: 13px;
}
</style>
