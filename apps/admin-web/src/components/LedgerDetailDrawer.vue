<template>
  <a-drawer :open="open" title="流水详情" :width="440" @close="emit('close')">
    <template v-if="entry">
      <div class="head">
        <LedgerTypeTag :type="entry.type" />
        <a-tag v-if="entry.reversedById">已冲正</a-tag>
        <div class="amount"><MoneyText :cent="entry.changeCent" signed /> <span class="unit">元</span></div>
      </div>
      <a-descriptions :column="1" size="small" bordered>
        <a-descriptions-item label="会员">
          <router-link :to="{ name: 'member-detail', params: { id: entry.memberId } }" @click="emit('close')">
            {{ entry.memberName || '未填称呼' }}
          </router-link>
          · {{ maskPhone(entry.memberPhone) }}
        </a-descriptions-item>
        <a-descriptions-item label="时间">{{ formatDateTime(entry.createdAt) }}</a-descriptions-item>
        <a-descriptions-item label="门店">{{ entry.storeName }}</a-descriptions-item>
        <a-descriptions-item label="操作人">{{ entry.operatorName || '系统' }}</a-descriptions-item>
        <a-descriptions-item label="变动前余额"><MoneyText :cent="entry.balanceBefore" /> 元</a-descriptions-item>
        <a-descriptions-item label="变动后余额"><MoneyText :cent="entry.balanceAfter" /> 元</a-descriptions-item>
        <a-descriptions-item label="备注">{{ entry.remark || '无' }}</a-descriptions-item>
        <a-descriptions-item v-if="entry.reversalOfId" label="抵掉的原流水">
          <a @click="emit('jump', entry.reversalOfId)">查看原流水</a>
        </a-descriptions-item>
        <a-descriptions-item v-if="entry.reversedById" label="冲正流水">
          <a @click="emit('jump', entry.reversedById)">查看冲正记录</a>
        </a-descriptions-item>
        <a-descriptions-item label="流水号"><span class="id">{{ entry.id }}</span></a-descriptions-item>
      </a-descriptions>
      <div v-if="reversible" class="actions">
        <a-button danger block @click="emit('reverse', entry)">记错了，冲正这笔</a-button>
      </div>
    </template>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LedgerEntry } from '../api/types';
import { useSessionStore } from '../stores/session';
import { formatDateTime } from '../utils/datetime';
import { maskPhone } from '../utils/phone';
import { canReverse } from '../utils/roles';
import LedgerTypeTag from './LedgerTypeTag.vue';
import MoneyText from './MoneyText.vue';

const props = defineProps<{ open: boolean; entry: LedgerEntry | null }>();
const emit = defineEmits<{ close: []; reverse: [entry: LedgerEntry]; jump: [id: string] }>();

const session = useSessionStore();
const reversible = computed(() => (props.entry ? canReverse(session.roles, props.entry) : false));
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.amount {
  margin-left: auto;
  font-size: 24px;
  font-weight: 600;
}

.unit {
  font-size: 14px;
  font-weight: 400;
  color: #64748b;
}

.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #64748b;
}

.actions {
  margin-top: 24px;
}
</style>
