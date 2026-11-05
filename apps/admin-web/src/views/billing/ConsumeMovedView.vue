<template>
  <div class="page">
    <a-card :bordered="false" class="block">
      <a-result status="info" title="消费抵扣需要在小程序的工作台里扫顾客的会员码">
        <template #subTitle>
          顾客打开小程序出示会员码，店员在手机上的小程序工作台扫码，再扫九讯云小票上方的订单码、填商品应付金额，最多抵
          10%、一单最多 1000 元，同一张单全公司只能抵一次。后台不能直接扣款，防止记错人。
        </template>
        <template #extra>
          <a-button type="primary" @click="router.push({ name: 'ledger', query: { type: 'CONSUME' } })">查看消费流水</a-button>
          <a-button v-if="session.canRecharge" @click="router.push({ name: 'recharge' })">去充值记账</a-button>
        </template>
      </a-result>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';

const router = useRouter();
const session = useSessionStore();
</script>

<style scoped>
.page {
  max-width: 880px;
}

.block {
  border-radius: 12px;
}
</style>
