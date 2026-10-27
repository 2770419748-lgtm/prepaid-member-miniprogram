<template>
  <div class="card">
    <div class="who">
      <div class="name">
        {{ member.name || '未填称呼' }}
        <a-tag v-if="member.status === 'DISABLED'" color="error">已停用</a-tag>
        <a-tag v-else-if="!member.hasCard" color="warning">未开卡</a-tag>
      </div>
      <div class="meta">
        {{ fullPhone ? member.phone : maskPhone(member.phone) }}
        <template v-if="member.openStoreName"> · {{ member.openStoreName }}开卡</template>
        <template v-if="member.openedAt"> · {{ formatDate(member.openedAt) }}</template>
      </div>
    </div>
    <div class="balance">
      <div class="label">余额（全公司门店通用）</div>
      <div class="value">
        <span class="num">{{ formatCent(member.balanceCent ?? 0) }}</span>
        <span class="unit">元</span>
      </div>
    </div>
    <div v-if="$slots.default" class="extra"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import type { MemberCard } from '../api/types';
import { formatDate } from '../utils/datetime';
import { formatCent } from '../utils/money';
import { maskPhone } from '../utils/phone';

defineProps<{ member: MemberCard; fullPhone?: boolean }>();
</script>

<style scoped>
.card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.who {
  flex: 1;
  min-width: 200px;
}

.name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
}

.meta {
  margin-top: 4px;
  color: #64748b;
}

.balance {
  text-align: right;
}

.label {
  color: #64748b;
  font-size: 12px;
}

.value {
  line-height: 1.1;
  margin-top: 4px;
}

.num {
  font-size: 36px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.unit {
  margin-left: 4px;
  color: #64748b;
}

.extra {
  width: 100%;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
