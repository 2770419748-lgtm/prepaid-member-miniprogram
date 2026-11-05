<template>
  <div>
    <h1 class="pm-page-title">小程序审核入口</h1>
    <p class="pm-page-sub">
      提交微信审核前打开。审核员在小程序登录页底部点「审核体验入口」，用这里的账号和密码登录，进的是一家单独的演示公司，
      看不到也改不了真实的门店、会员和流水。打开 {{ days }} 天后自动关闭，审完也可以手动关。
    </p>

    <a-card :bordered="false" class="block" :loading="loading && !status">
      <template v-if="status">
        <div class="state">
          <a-tag :color="status.enabled ? 'success' : 'default'" class="state-tag">
            {{ status.enabled ? '已打开' : '已关闭' }}
          </a-tag>
          <span v-if="status.enabled" class="state-text">{{ formatDateTime(status.until) }} 自动关闭</span>
          <span v-else class="state-text muted">小程序登录页不显示审核体验入口</span>
        </div>

        <a-descriptions :column="1" size="middle" bordered class="desc">
          <a-descriptions-item label="审核账号">
            <span class="mono">{{ status.account }}</span>
            <a-button size="small" type="link" @click="copy(status.account, '账号')">复制</a-button>
          </a-descriptions-item>
          <a-descriptions-item label="审核密码">
            <template v-if="status.enabled && password">
              <span class="mono strong">{{ password }}</span>
              <a-button size="small" type="link" @click="copy(password, '密码')">复制</a-button>
            </template>
            <span v-else-if="status.enabled" class="muted">已设置。密码只在打开时显示一次，忘了可以点「换一个密码」。</span>
            <span v-else class="muted">打开时生成</span>
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="status.enabled && password"
          type="warning"
          show-icon
          class="gap"
          message="密码只显示这一次"
          description="请现在把账号和密码填进微信提审表单。离开这个页面后就看不到了，忘了可以点「换一个密码」。"
        />

        <div class="actions">
          <a-button v-if="!status.enabled" type="primary" :loading="busy === 'open'" @click="open">
            打开 {{ days }} 天
          </a-button>
          <template v-else>
            <a-button :loading="busy === 'open'" @click="open">从现在起再开 {{ days }} 天</a-button>
            <a-button :loading="busy === 'password'" @click="rotate">换一个密码</a-button>
            <a-popconfirm
              title="关闭后审核员马上进不去，正在审核的话会被打断。确定关闭？"
              ok-text="关闭入口"
              cancel-text="取消"
              :ok-button-props="{ danger: true }"
              @confirm="close"
            >
              <a-button danger :loading="busy === 'close'">关闭入口</a-button>
            </a-popconfirm>
          </template>
        </div>
        <a-alert v-if="error" type="error" show-icon class="gap" :message="error" />
      </template>
    </a-card>

    <div class="grid">
      <a-card :bordered="false" title="提审时怎么填">
        <ol class="steps">
          <li>点「打开 {{ days }} 天」，复制账号和密码。</li>
          <li>
            在微信公众平台提交审核时，「测试账号」填 <span class="mono">{{ status?.account ?? 'shenhe' }}</span>，「测试密码」填上面的密码。
          </li>
          <li>
            审核说明可以这样写：
            <div class="quote">
              {{ reviewNote }}
              <a-button size="small" type="link" @click="copy(reviewNote, '审核说明')">复制</a-button>
            </div>
          </li>
          <li>审核通过后回到这里点「关闭入口」。忘了关也没关系，{{ days }} 天后自动关闭。</li>
        </ol>
      </a-card>

      <a-card :bordered="false" title="演示公司">
        <p v-if="status?.demo">
          演示公司（仅供审核体验）：{{ status.demo.stores }} 家演示门店、{{ status.demo.members }} 位演示会员和几笔演示流水，
          审核员是两家演示门店的店长。
        </p>
        <p v-else>第一次打开时自动建好：两家演示门店、四位有余额和流水的演示会员，审核员是两家店的店长。</p>
        <ul class="notes">
          <li>演示数据都是虚构的。审核员在演示公司里做的充值等操作，不进你的会员、流水和对账。</li>
          <li>审核员在演示公司里开单上传的协议单照片也只留在演示公司；不会发起真实的电子合同，不产生签署费用。</li>
          <li>演示数据一直留着，下次提审再打开接着用。</li>
          <li>打开、延长、换密码、关闭和审核员每次登录，都记在操作记录里。</li>
        </ul>
      </a-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { message } from 'ant-design-vue';
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../../api/http';
import {
  closeReviewDemo,
  getReviewDemo,
  openReviewDemo,
  rotateReviewDemoPassword,
  type ReviewDemoStatus,
} from '../../api/review-demo';
import { formatDateTime } from '../../utils/datetime';

const status = ref<ReviewDemoStatus | null>(null);
/** 刚生成的密码。只在这次页面里显示，刷新就没了（服务端只存哈希）。 */
const password = ref('');
const loading = ref(false);
const busy = ref<'' | 'open' | 'password' | 'close'>('');
const error = ref('');

const days = computed(() => status.value?.days ?? 7);
const reviewNote =
  '本小程序是门店储值会员系统，员工和会员共用。请在登录页底部点「审核体验入口」，输入测试账号和密码进入员工工作台；在工作台点「切到我的会员卡」可以体验会员页面。体验账号里的门店、会员和流水都是演示数据。';

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    status.value = await getReviewDemo();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function run(kind: 'open' | 'password' | 'close'): Promise<void> {
  busy.value = kind;
  error.value = '';
  try {
    if (kind === 'close') {
      status.value = await closeReviewDemo();
      password.value = '';
      message.success('已关闭，审核员的登录已失效');
      return;
    }
    const secret = kind === 'open' ? await openReviewDemo() : await rotateReviewDemoPassword();
    const { password: fresh, ...rest } = secret;
    status.value = rest;
    password.value = fresh;
    message.success(kind === 'open' ? `已打开，${formatDateTime(rest.until)} 自动关闭` : '已换新密码，旧密码作废');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = '';
  }
}

const open = () => run('open');
const rotate = () => run('password');
const close = () => run('close');

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    message.success(`${what}已复制`);
  } catch {
    message.warning('浏览器不允许自动复制，请手动选中复制');
  }
}

onMounted(load);
</script>

<style scoped>
.block {
  margin-bottom: 16px;
}

.state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.state-tag {
  font-size: 14px;
  padding: 2px 10px;
}

.state-text {
  color: #334155;
}

.muted {
  color: #94a3b8;
}

.desc {
  max-width: 640px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.5px;
}

.strong {
  font-size: 16px;
  font-weight: 600;
}

.gap {
  margin-top: 16px;
  max-width: 640px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.steps,
.notes {
  margin: 0;
  padding-left: 20px;
  color: #334155;
  line-height: 1.9;
}

.quote {
  margin: 6px 0 4px;
  padding: 8px 12px;
  background: #f8fafc;
  border-left: 3px solid #cbd5e1;
  color: #475569;
  line-height: 1.7;
}
</style>
