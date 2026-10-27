<template>
  <div class="page">
    <a-card :bordered="false" class="block">
      <a-result status="info" title="消费扣款需要在员工小程序里扫顾客的会员码">
        <template #subTitle>
          顾客打开会员小程序出示会员码，店员用手机上的员工小程序扫码后再填金额。后台不能直接扣款，防止记错人。
        </template>
        <template #extra>
          <a-button type="primary" @click="router.push({ name: 'ledger', query: { type: 'CONSUME' } })">查看消费流水</a-button>
          <a-button @click="router.push({ name: 'recharge' })">去充值记账</a-button>
        </template>
      </a-result>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<style scoped>
.page {
  max-width: 880px;
}

.block {
  border-radius: 12px;
}
</style>
