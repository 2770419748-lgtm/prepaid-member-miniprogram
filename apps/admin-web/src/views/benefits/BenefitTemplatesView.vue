<template>
  <div>
    <h1 class="pm-page-title">权益单模板</h1>
    <p class="pm-page-sub">
      先写好「权益方案」（会员能享受什么），再把 e签宝里做好的合同模板绑上来。启用后，门店就能对会员发起线上签署。
    </p>
    <a-alert class="gap" type="warning" show-icon message="当前是测试环境（沙箱），签出来的权益单不具法律效力。正式签署要等公司主体和企业章就绪后才打开。" />

    <a-result v-if="missing" status="info" title="电子签功能还在接入中" sub-title="接口上线后这里就能配置权益方案和合同模板。" />

    <a-tabs v-else v-model:active-key="tab">
      <a-tab-pane key="plans" tab="权益方案">
        <a-card :bordered="false" class="block">
          <div class="pm-toolbar">
            <a-radio-group v-model:value="planStatus" button-style="solid" @change="loadPlans(1)">
              <a-radio-button value="">全部</a-radio-button>
              <a-radio-button value="ACTIVE">启用</a-radio-button>
              <a-radio-button value="DRAFT">草稿</a-radio-button>
              <a-radio-button value="ARCHIVED">已归档</a-radio-button>
            </a-radio-group>
            <span class="pm-spacer" />
            <a-button v-if="session.superAdmin" type="primary" @click="openPlan(null)">新建权益方案</a-button>
          </div>
          <a-table
            :columns="planColumns"
            :data-source="plans"
            :loading="plansLoading"
            :pagination="planPagination"
            row-key="id"
            @change="(p: TablePaginationConfig) => loadPlans(p.current ?? 1)"
          >
            <template #emptyText><a-empty description="还没有权益方案" /></template>
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">
                <div class="strong">{{ record.title }}</div>
                <div class="muted">{{ record.summary }}</div>
              </template>
              <template v-else-if="column.key === 'items'">
                <div v-for="(item, i) in record.items.slice(0, 3)" :key="i" class="item">· {{ item.title }}</div>
                <div v-if="record.items.length > 3" class="muted">等 {{ record.items.length }} 项</div>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-tag :color="PLAN_STATUS[record.status as PlanStatus].color">{{ PLAN_STATUS[record.status as PlanStatus].label }}</a-tag>
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space v-if="session.superAdmin" :size="4">
                  <a-button type="link" size="small" @click="openPlan(record)">编辑</a-button>
                  <a-button v-if="record.status !== 'ARCHIVED'" type="link" size="small" @click="setPlanStatus(record, 'ARCHIVED')">
                    归档
                  </a-button>
                  <a-button v-else type="link" size="small" @click="setPlanStatus(record, 'ACTIVE')">重新启用</a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="templates" tab="合同模板">
        <a-card :bordered="false" class="block">
          <div class="pm-toolbar">
            <span class="muted">合同模板在 e签宝沙箱后台制作，这里只填模板编号并绑定权益方案。</span>
            <span class="pm-spacer" />
            <a-button v-if="session.superAdmin" type="primary" @click="openTemplate(null)">绑定合同模板</a-button>
          </div>
          <a-table
            :columns="templateColumns"
            :data-source="templates"
            :loading="templatesLoading"
            :pagination="templatePagination"
            row-key="id"
            @change="(p: TablePaginationConfig) => loadTemplates(p.current ?? 1)"
          >
            <template #emptyText><a-empty description="还没有绑定合同模板" /></template>
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <div class="strong">{{ record.name }}</div>
                <div class="muted mono">{{ record.esignTemplateId }}</div>
              </template>
              <template v-else-if="column.key === 'plan'">
                <span :class="{ muted: !record.benefitPlan }">{{ record.benefitPlan?.title ?? '未关联' }}</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-tag :color="TEMPLATE_STATUS[record.status as TemplateStatus].color">
                  {{ TEMPLATE_STATUS[record.status as TemplateStatus].label }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space :size="4">
                  <a-button
                    v-if="record.status === 'ACTIVE'"
                    type="link"
                    size="small"
                    @click="router.push({ name: 'sign-flows', query: { templateId: record.id, start: '1' } })"
                  >
                    发起签署
                  </a-button>
                  <template v-if="session.superAdmin">
                    <a-button type="link" size="small" @click="openTemplate(record)">编辑</a-button>
                    <a-button
                      v-if="record.status === 'ACTIVE'"
                      type="link"
                      size="small"
                      danger
                      @click="setTemplateStatus(record, 'DRAFT')"
                    >
                      停用
                    </a-button>
                    <a-button v-else type="link" size="small" @click="setTemplateStatus(record, 'ACTIVE')">启用</a-button>
                  </template>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- 权益方案表单 -->
    <a-modal
      :open="planOpen"
      :title="editingPlan ? '编辑权益方案' : '新建权益方案'"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      :mask-closable="false"
      width="640px"
      @ok="savePlan"
      @cancel="planOpen = false"
    >
      <a-form layout="vertical">
        <a-form-item label="方案名称" required>
          <a-input v-model:value="planForm.title" :maxlength="80" placeholder="例如：年度储值会员权益" />
        </a-form-item>
        <a-form-item label="一句话说明">
          <a-input v-model:value="planForm.summary" :maxlength="200" placeholder="会员首页显示的摘要" />
        </a-form-item>
        <a-form-item label="权益条目" required extra="1 到 20 条，会员小程序最多展示前 3 条">
          <div v-for="(item, i) in planForm.items" :key="i" class="item-row">
            <a-input v-model:value="item.title" :maxlength="80" placeholder="权益名称" style="width: 200px" />
            <a-input v-model:value="item.detail" :maxlength="500" placeholder="细则（可不填）" style="flex: 1" />
            <a-button type="text" danger :disabled="planForm.items.length <= 1" @click="planForm.items.splice(i, 1)">移除</a-button>
          </div>
          <a-button type="dashed" block :disabled="planForm.items.length >= 20" @click="planForm.items.push({ title: '', detail: '' })">
            添加一条权益
          </a-button>
        </a-form-item>
        <a-form-item label="适用规则">
          <a-textarea v-model:value="planForm.rules" :rows="3" :maxlength="2000" placeholder="例如：储值终身有效，用完为止；全公司门店通用" />
        </a-form-item>
        <a-form-item label="状态">
          <a-radio-group v-model:value="planForm.status">
            <a-radio value="ACTIVE">启用</a-radio>
            <a-radio value="DRAFT">草稿</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>

    <!-- 合同模板表单 -->
    <a-modal
      :open="templateOpen"
      :title="editingTemplate ? '编辑合同模板' : '绑定合同模板'"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      :mask-closable="false"
      width="560px"
      @ok="saveTemplate"
      @cancel="templateOpen = false"
    >
      <a-form layout="vertical">
        <a-form-item label="模板名称" required>
          <a-input v-model:value="templateForm.name" :maxlength="80" placeholder="例如：储值会员权益单" />
        </a-form-item>
        <a-form-item
          label="e签宝模板编号"
          required
          extra="在 e签宝沙箱后台「模板管理」里复制。保存时会去沙箱核对这个模板是否存在。"
        >
          <a-input v-model:value="templateForm.esignTemplateId" :disabled="!!editingTemplate" :maxlength="64" class="mono" />
        </a-form-item>
        <a-form-item label="关联权益方案">
          <a-select v-model:value="templateForm.benefitPlanId" :options="planOptions" allow-clear placeholder="选择权益方案" />
        </a-form-item>
        <a-form-item label="状态">
          <a-radio-group v-model:value="templateForm.status">
            <a-radio value="ACTIVE">启用</a-radio>
            <a-radio value="DRAFT">停用</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-collapse ghost>
          <a-collapse-panel key="adv" header="高级：签字和盖章的位置">
            <a-form-item label="会员签字处的关键字" extra="合同里这几个字的位置会放会员签名">
              <a-input v-model:value="templateForm.memberSignKeyword" :maxlength="40" />
            </a-form-item>
            <a-form-item label="商家盖章处的关键字" extra="合同里这几个字的位置会盖商家章">
              <a-input v-model:value="templateForm.sealKeyword" :maxlength="40" />
            </a-form-item>
          </a-collapse-panel>
        </a-collapse>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message, type TablePaginationConfig } from 'ant-design-vue';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  createPlan,
  createTemplate,
  listPlans,
  listTemplates,
  updatePlan,
  updateTemplate,
  type BenefitPlan,
  type ContractTemplate,
  type PlanStatus,
  type TemplateStatus,
} from '../../api/esign';
import { errorMessage, errorStatus, isNotFound } from '../../api/http';
import { useSessionStore } from '../../stores/session';
import { PLAN_STATUS, TEMPLATE_STATUS } from '../../utils/esign';

const router = useRouter();
const session = useSessionStore();

const tab = ref<'plans' | 'templates'>('plans');
const missing = ref(false);
const saving = ref(false);
const formError = ref('');

// 权益方案
const planStatus = ref<'' | PlanStatus>('');
const plans = ref<BenefitPlan[]>([]);
const plansLoading = ref(false);
const planPage = ref(1);
const planTotal = ref(0);
const allPlans = ref<BenefitPlan[]>([]);

const planColumns: ColumnsType<BenefitPlan> = [
  { title: '权益方案', key: 'title' },
  { title: '权益条目', key: 'items', width: 260 },
  { title: '合同模板', dataIndex: 'templateCount', key: 'templateCount', width: 100, align: 'right' },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'actions', width: 150 },
];

const planPagination = computed<TablePaginationConfig>(() => ({
  current: planPage.value,
  pageSize: 20,
  total: planTotal.value,
}));

const planOptions = computed(() =>
  allPlans.value.filter((p) => p.status !== 'ARCHIVED').map((p) => ({ value: p.id, label: p.title })),
);

async function loadPlans(page = planPage.value): Promise<void> {
  planPage.value = page;
  plansLoading.value = true;
  try {
    const result = await listPlans({ page, pageSize: 20, status: planStatus.value || undefined });
    plans.value = result.items;
    planTotal.value = result.total;
  } catch (e) {
    if (isNotFound(e)) {
      missing.value = true;
    } else {
      message.error(errorMessage(e));
    }
  } finally {
    plansLoading.value = false;
  }
}

async function loadAllPlans(): Promise<void> {
  try {
    allPlans.value = (await listPlans({ pageSize: 100 })).items;
  } catch {
    allPlans.value = [];
  }
}

const planOpen = ref(false);
const editingPlan = ref<BenefitPlan | null>(null);
const planForm = reactive({
  title: '',
  summary: '',
  items: [{ title: '', detail: '' }] as { title: string; detail: string }[],
  rules: '',
  status: 'ACTIVE' as PlanStatus,
});

function openPlan(plan: BenefitPlan | null): void {
  editingPlan.value = plan;
  planForm.title = plan?.title ?? '';
  planForm.summary = plan?.summary ?? '';
  planForm.items = plan?.items.length
    ? plan.items.map((i) => ({ title: i.title, detail: i.detail ?? '' }))
    : [{ title: '', detail: '' }];
  planForm.rules = plan?.rules ?? '';
  planForm.status = plan?.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
  formError.value = '';
  planOpen.value = true;
}

async function savePlan(): Promise<void> {
  const title = planForm.title.trim();
  const items = planForm.items
    .map((i) => ({ title: i.title.trim(), detail: i.detail.trim() || undefined }))
    .filter((i) => i.title);
  if (!title) {
    formError.value = '请填写方案名称';
    return;
  }
  if (items.length === 0) {
    formError.value = '至少写一条权益';
    return;
  }
  const body = {
    title,
    summary: planForm.summary.trim() || undefined,
    items,
    rules: planForm.rules.trim() || undefined,
    status: planForm.status,
  };
  saving.value = true;
  formError.value = '';
  try {
    if (editingPlan.value) {
      await updatePlan(editingPlan.value.id, body);
    } else {
      await createPlan(body);
    }
    message.success('权益方案已保存');
    planOpen.value = false;
    await Promise.all([loadPlans(), loadAllPlans()]);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function setPlanStatus(plan: BenefitPlan, status: PlanStatus): Promise<void> {
  try {
    await updatePlan(plan.id, { status });
    message.success(status === 'ARCHIVED' ? '已归档，不能再用来发起新的签署' : '已重新启用');
    await Promise.all([loadPlans(), loadAllPlans()]);
  } catch (e) {
    message.error(errorMessage(e));
  }
}

// 合同模板
const templates = ref<ContractTemplate[]>([]);
const templatesLoading = ref(false);
const templatePage = ref(1);
const templateTotal = ref(0);

const templateColumns: ColumnsType<ContractTemplate> = [
  { title: '合同模板', key: 'name' },
  { title: '权益方案', key: 'plan', width: 200 },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'actions', width: 210 },
];

const templatePagination = computed<TablePaginationConfig>(() => ({
  current: templatePage.value,
  pageSize: 20,
  total: templateTotal.value,
}));

async function loadTemplates(page = templatePage.value): Promise<void> {
  templatePage.value = page;
  templatesLoading.value = true;
  try {
    const result = await listTemplates({ page, pageSize: 20 });
    templates.value = result.items;
    templateTotal.value = result.total;
  } catch (e) {
    if (isNotFound(e)) {
      missing.value = true;
    } else {
      message.error(errorMessage(e));
    }
  } finally {
    templatesLoading.value = false;
  }
}

const templateOpen = ref(false);
const editingTemplate = ref<ContractTemplate | null>(null);
const templateForm = reactive({
  name: '',
  esignTemplateId: '',
  benefitPlanId: undefined as string | undefined,
  status: 'ACTIVE' as TemplateStatus,
  memberSignKeyword: '会员签字',
  sealKeyword: '商家盖章',
});

function openTemplate(template: ContractTemplate | null): void {
  editingTemplate.value = template;
  templateForm.name = template?.name ?? '';
  templateForm.esignTemplateId = template?.esignTemplateId ?? '';
  templateForm.benefitPlanId = template?.benefitPlan?.id;
  templateForm.status = template?.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
  templateForm.memberSignKeyword = template?.memberSignKeyword ?? '会员签字';
  templateForm.sealKeyword = template?.sealKeyword ?? '商家盖章';
  formError.value = '';
  templateOpen.value = true;
}

async function saveTemplate(): Promise<void> {
  const name = templateForm.name.trim();
  const esignTemplateId = templateForm.esignTemplateId.trim();
  if (!name || !esignTemplateId) {
    formError.value = '请填写模板名称和 e签宝模板编号';
    return;
  }
  saving.value = true;
  formError.value = '';
  const common = {
    name,
    status: templateForm.status,
    memberSignKeyword: templateForm.memberSignKeyword.trim() || undefined,
    sealKeyword: templateForm.sealKeyword.trim() || undefined,
  };
  try {
    if (editingTemplate.value) {
      await updateTemplate(editingTemplate.value.id, { ...common, benefitPlanId: templateForm.benefitPlanId ?? null });
    } else {
      await createTemplate({ ...common, esignTemplateId, benefitPlanId: templateForm.benefitPlanId });
    }
    message.success('合同模板已保存');
    templateOpen.value = false;
    await Promise.all([loadTemplates(), loadPlans()]);
  } catch (e) {
    formError.value =
      errorStatus(e) === 503 ? '电子签沙箱账号还没配置，暂时不能核对模板。请联系技术人员在服务器上配置沙箱凭据。' : errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function setTemplateStatus(template: ContractTemplate, status: TemplateStatus): Promise<void> {
  try {
    await updateTemplate(template.id, { status });
    message.success(status === 'ACTIVE' ? '已启用，门店可以用它发起签署' : '已停用，不能再发起新的签署');
    await loadTemplates();
  } catch (e) {
    message.error(errorMessage(e));
  }
}

onMounted(() => {
  void loadPlans(1);
  void loadAllPlans();
  void loadTemplates(1);
});
</script>

<style scoped>
.gap {
  margin-bottom: 12px;
}

.block {
  border-radius: 12px;
}

.strong {
  font-weight: 500;
}

.muted {
  color: #64748b;
  font-size: 12px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.item {
  line-height: 22px;
}

.item-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
