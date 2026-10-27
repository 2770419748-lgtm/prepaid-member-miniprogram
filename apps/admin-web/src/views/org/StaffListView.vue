<template>
  <div>
    <h1 class="pm-page-title">员工管理</h1>
    <p class="pm-page-sub">
      <template v-if="session.superAdmin">可以给任意门店开通店长、店员账号，调整角色和重置密码。</template>
      <template v-else>店长可以在本店开通普通店员、改名和停用；不能任命店长，也不能改自己或其他店长。</template>
      新账号和重置后的账号，第一次登录都必须先改密码。
    </p>
    <a-card :bordered="false" class="block">
      <div class="pm-toolbar">
        <a-select
          v-model:value="storeId"
          :options="filterStoreOptions"
          placeholder="全部门店"
          allow-clear
          style="width: 200px"
          @change="reload(1)"
        />
        <span class="pm-spacer" />
        <a-button type="primary" @click="openCreate">开通员工账号</a-button>
      </div>
      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        :scroll="{ x: 1000 }"
        @change="onTableChange"
      >
        <template #emptyText><a-empty description="还没有员工" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="name">{{ record.name }}</span>
            <a-tag v-if="record.id === session.staff?.id" class="self">我</a-tag>
          </template>
          <template v-else-if="column.key === 'phone'">{{ maskPhone(record.phone) }}</template>
          <template v-else-if="column.key === 'roles'">
            <a-space wrap :size="4">
              <a-tag v-for="role in record.roles" :key="role.storeId" :color="roleColor(role.role)">
                {{ role.storeName }} · {{ ROLE_LABEL[role.role as StaffRole] }}
              </a-tag>
              <span v-if="record.roles.length === 0" class="muted">未分配门店</span>
            </a-space>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.status === 'ACTIVE' ? 'success' : 'default'">
              {{ record.status === 'ACTIVE' ? '在职' : '已停用' }}
            </a-tag>
            <a-tag v-if="record.mustChangePassword" color="warning">待首次改密</a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space v-if="editable(record)" :size="4" wrap>
              <a-button type="link" size="small" @click="openEdit(record)">改名</a-button>
              <a-button v-if="record.id !== session.staff?.id" type="link" size="small" @click="openRoles(record)">
                门店角色
              </a-button>
              <a-button v-if="session.superAdmin" type="link" size="small" @click="openReset(record)">重置密码</a-button>
              <a-button
                v-if="record.id !== session.staff?.id"
                type="link"
                size="small"
                :danger="record.status === 'ACTIVE'"
                @click="toggleStatus(record)"
              >
                {{ record.status === 'ACTIVE' ? '停用' : '恢复' }}
              </a-button>
            </a-space>
            <span v-else class="muted">无权修改</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 开通账号 -->
    <a-modal
      :open="createOpen"
      title="开通员工账号"
      ok-text="开通"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      :mask-closable="false"
      @ok="submitCreate"
      @cancel="createOpen = false"
    >
      <a-form ref="createRef" layout="vertical" :model="createForm">
        <a-form-item label="姓名" name="name" :rules="[{ required: true, whitespace: true, message: '请填写姓名' }]">
          <a-input v-model:value="createForm.name" :maxlength="40" />
        </a-form-item>
        <a-form-item label="手机号" name="phone" :rules="phoneRules" extra="员工用这个手机号登录后台和员工小程序">
          <a-input v-model:value="createForm.phone" :maxlength="13" />
        </a-form-item>
        <a-row :gutter="12">
          <a-col :span="14">
            <a-form-item label="门店" name="storeId" :rules="[{ required: true, message: '请选择门店' }]">
              <a-select v-model:value="createForm.storeId" :options="assignableStores" />
            </a-form-item>
          </a-col>
          <a-col :span="10">
            <a-form-item label="角色" name="role" :rules="[{ required: true, message: '请选择角色' }]">
              <a-select v-model:value="createForm.role" :options="assignableRoles" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="初始密码" name="password" :rules="passwordRules" extra="请把初始密码当面告诉员工，第一次登录要改掉">
          <a-input v-model:value="createForm.password" :maxlength="64">
            <template #addonAfter><a @click="createForm.password = generateInitialPassword()">随机生成</a></template>
          </a-input>
        </a-form-item>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>

    <!-- 改名 / 改手机号 -->
    <a-modal
      :open="!!editing"
      :title="`修改员工：${editing?.name ?? ''}`"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      @ok="submitEdit"
      @cancel="editing = null"
    >
      <a-form layout="vertical">
        <a-form-item label="姓名" required>
          <a-input v-model:value="editForm.name" :maxlength="40" />
        </a-form-item>
        <a-form-item v-if="session.superAdmin" label="手机号" extra="只有超级管理员能改手机号">
          <a-input v-model:value="editForm.phone" :maxlength="13" />
        </a-form-item>
        <a-alert v-if="formError" type="error" show-icon :message="formError" />
      </a-form>
    </a-modal>

    <!-- 门店角色 -->
    <a-modal
      :open="!!roleTarget"
      :title="`门店角色：${roleTarget?.name ?? ''}`"
      ok-text="保存"
      cancel-text="取消"
      :ok-button-props="{ loading: saving }"
      width="560px"
      @ok="submitRoles"
      @cancel="roleTarget = null"
    >
      <p class="muted">
        <template v-if="session.superAdmin">一位员工可以在多家门店有角色。超级管理员在任意一家店有这个角色就能管全公司。</template>
        <template v-else>只能调整你管理的门店，只能分配「店员」。</template>
      </p>
      <div v-for="(row, index) in roleRows" :key="index" class="role-row">
        <a-select v-model:value="row.storeId" :options="assignableStores" placeholder="门店" style="flex: 1" />
        <a-select v-model:value="row.role" :options="assignableRoles" style="width: 140px" />
        <a-button type="text" danger @click="roleRows.splice(index, 1)">移除</a-button>
      </div>
      <a-button type="dashed" block @click="roleRows.push({ storeId: undefined, role: 'STAFF' })">添加门店</a-button>
      <a-alert v-if="formError" class="gap" type="error" show-icon :message="formError" />
    </a-modal>

    <!-- 重置密码 -->
    <a-modal
      :open="!!resetTarget"
      :title="`重置密码：${resetTarget?.name ?? ''}`"
      ok-text="重置"
      cancel-text="取消"
      :ok-button-props="{ loading: saving, danger: true }"
      @ok="submitReset"
      @cancel="resetTarget = null"
    >
      <p class="muted">重置后旧密码立即失效，账号的锁定也会解除。员工用新的初始密码登录后必须再改一次。</p>
      <a-input v-model:value="resetPassword" :maxlength="64">
        <template #addonAfter><a @click="resetPassword = generateInitialPassword()">随机生成</a></template>
      </a-input>
      <a-alert v-if="formError" class="gap" type="error" show-icon :message="formError" />
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { message, Modal, type TablePaginationConfig } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import type { ColumnsType } from 'ant-design-vue/es/table';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '../../api/http';
import { createStaff, listStaff, replaceStaffRoles, resetStaffPassword, updateStaff } from '../../api/org';
import type { StaffRole, StaffView } from '../../api/types';
import { useSessionStore } from '../../stores/session';
import { generateInitialPassword } from '../../utils/password';
import { isMobile, maskPhone, normalizePhone } from '../../utils/phone';
import { canEditStaff, ROLE_LABEL } from '../../utils/roles';

const route = useRoute();
const session = useSessionStore();

const storeId = ref<string | undefined>(typeof route.query.storeId === 'string' ? route.query.storeId : undefined);
const rows = ref<StaffView[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const saving = ref(false);
const formError = ref('');

const columns: ColumnsType<StaffView> = [
  { title: '姓名', key: 'name', width: 160 },
  { title: '手机号', key: 'phone', width: 130 },
  { title: '门店与角色', key: 'roles' },
  { title: '状态', key: 'status', width: 180 },
  { title: '操作', key: 'actions', width: 300, fixed: 'right' },
];

const pagination = computed<TablePaginationConfig>(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showTotal: (n: number) => `共 ${n} 人`,
}));

/** 能在这里分配的门店：超级管理员全部，店长只限自己管的店。 */
const assignableStores = computed(() =>
  session.stores
    .filter((s) => session.superAdmin || session.managed.includes(s.id))
    .map((s) => ({ value: s.id, label: s.status === 'DISABLED' ? `${s.name}（已停用）` : s.name })),
);
const filterStoreOptions = assignableStores;

const assignableRoles = computed(() =>
  (session.superAdmin ? (['STAFF', 'STORE_MANAGER', 'SUPER_ADMIN'] as StaffRole[]) : (['STAFF'] as StaffRole[])).map(
    (role) => ({ value: role, label: ROLE_LABEL[role] }),
  ),
);

function roleColor(role: StaffRole): string {
  return role === 'SUPER_ADMIN' ? 'purple' : role === 'STORE_MANAGER' ? 'blue' : 'default';
}

function editable(staff: StaffView): boolean {
  return canEditStaff(session.roles, session.staff?.id ?? '', staff);
}

const phoneRules: Rule[] = [
  { required: true, message: '请填写手机号' },
  {
    validator: async (_rule, value: string) => {
      if (value && !isMobile(value)) {
        throw new Error('请输入 11 位手机号');
      }
    },
  },
];

const passwordRules: Rule[] = [
  { required: true, message: '请设置初始密码' },
  { min: 8, max: 64, message: '密码要 8 到 64 位' },
];

async function reload(toPage = page.value): Promise<void> {
  page.value = toPage;
  loading.value = true;
  try {
    const result = await listStaff({ page: page.value, pageSize: pageSize.value, storeId: storeId.value });
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

function onTableChange(p: TablePaginationConfig): void {
  pageSize.value = p.pageSize ?? pageSize.value;
  void reload(p.current ?? 1);
}

// 开通账号
const createOpen = ref(false);
const createRef = ref<{ validate: () => Promise<unknown> } | null>(null);
const createForm = reactive({
  name: '',
  phone: '',
  storeId: undefined as string | undefined,
  role: 'STAFF' as StaffRole,
  password: '',
});

function openCreate(): void {
  createForm.name = '';
  createForm.phone = '';
  createForm.storeId =
    storeId.value ??
    (assignableStores.value.some((s) => s.value === session.currentStoreId) ? session.currentStoreId ?? undefined : undefined) ??
    assignableStores.value[0]?.value;
  createForm.role = 'STAFF';
  createForm.password = generateInitialPassword();
  formError.value = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  try {
    await createRef.value?.validate();
  } catch {
    return;
  }
  if (!createForm.storeId) {
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const created = await createStaff({
      name: createForm.name.trim(),
      phone: normalizePhone(createForm.phone),
      storeId: createForm.storeId,
      role: createForm.role,
      password: createForm.password,
    });
    createOpen.value = false;
    Modal.success({
      title: '账号已开通',
      content: `${created.name}（${created.phone}）的初始密码是 ${createForm.password}。请当面告诉员工，第一次登录要改掉。这个密码关掉后不会再显示。`,
      okText: '知道了',
    });
    await reload(1);
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// 改名
const editing = ref<StaffView | null>(null);
const editForm = reactive({ name: '', phone: '' });

function openEdit(staff: StaffView): void {
  editing.value = staff;
  editForm.name = staff.name;
  editForm.phone = staff.phone;
  formError.value = '';
}

async function submitEdit(): Promise<void> {
  if (!editing.value) {
    return;
  }
  const name = editForm.name.trim();
  if (!name) {
    formError.value = '姓名不能为空';
    return;
  }
  const body: { name?: string; phone?: string } = {};
  if (name !== editing.value.name) {
    body.name = name;
  }
  if (session.superAdmin) {
    const phone = normalizePhone(editForm.phone);
    if (!isMobile(phone)) {
      formError.value = '请输入 11 位手机号';
      return;
    }
    if (phone !== editing.value.phone) {
      body.phone = phone;
    }
  }
  if (!body.name && !body.phone) {
    editing.value = null;
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    await updateStaff(editing.value.id, body);
    message.success('已保存');
    editing.value = null;
    await reload();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// 门店角色
const roleTarget = ref<StaffView | null>(null);
const roleRows = ref<{ storeId: string | undefined; role: StaffRole }[]>([]);

function openRoles(staff: StaffView): void {
  roleTarget.value = staff;
  roleRows.value = staff.roles.map((r) => ({ storeId: r.storeId, role: r.role }));
  formError.value = '';
}

async function submitRoles(): Promise<void> {
  if (!roleTarget.value) {
    return;
  }
  const filled = roleRows.value.filter((r): r is { storeId: string; role: StaffRole } => !!r.storeId);
  if (new Set(filled.map((r) => r.storeId)).size !== filled.length) {
    formError.value = '同一家门店只能选一个角色';
    return;
  }
  if (filled.length === 0 && roleTarget.value.id !== session.staff?.id) {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '移除全部门店？',
        content: '没有门店的员工登录后什么都做不了。确定要这样保存吗？',
        okText: '确定',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) {
      return;
    }
  }
  saving.value = true;
  formError.value = '';
  try {
    await replaceStaffRoles(roleTarget.value.id, filled);
    message.success('门店角色已更新');
    roleTarget.value = null;
    await reload();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

// 重置密码
const resetTarget = ref<StaffView | null>(null);
const resetPassword = ref('');

function openReset(staff: StaffView): void {
  resetTarget.value = staff;
  resetPassword.value = generateInitialPassword();
  formError.value = '';
}

async function submitReset(): Promise<void> {
  if (!resetTarget.value) {
    return;
  }
  if (resetPassword.value.length < 8 || resetPassword.value.length > 64) {
    formError.value = '密码要 8 到 64 位';
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const target = resetTarget.value;
    await resetStaffPassword(target.id, resetPassword.value);
    resetTarget.value = null;
    Modal.success({
      title: '密码已重置',
      content: `${target.name} 的新初始密码是 ${resetPassword.value}。请当面告诉员工，登录后要再改一次。`,
      okText: '知道了',
    });
    await reload();
  } catch (e) {
    formError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

function toggleStatus(staff: StaffView): void {
  const disabling = staff.status === 'ACTIVE';
  Modal.confirm({
    title: disabling ? `停用「${staff.name}」的账号？` : `恢复「${staff.name}」的账号？`,
    content: disabling
      ? '停用后这个账号不能再登录后台和员工小程序。已经记过的账不受影响。'
      : '恢复后这个账号可以重新登录。',
    okText: disabling ? '确认停用' : '确认恢复',
    okButtonProps: { danger: disabling },
    cancelText: '取消',
    async onOk() {
      try {
        await updateStaff(staff.id, { status: disabling ? 'DISABLED' : 'ACTIVE' });
        message.success(disabling ? '账号已停用' : '账号已恢复');
        await reload();
      } catch (e) {
        message.error(errorMessage(e));
      }
    },
  });
}

onMounted(() => reload(1));
</script>

<style scoped>
.block {
  border-radius: 12px;
}

.name {
  font-weight: 500;
}

.self {
  margin-left: 6px;
}

.muted {
  color: #64748b;
}

.role-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.gap {
  margin-top: 12px;
}
</style>
