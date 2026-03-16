<template>
  <div class="org-view">
    <!-- Sub panel -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.org') }}</span>
        <a-button type="primary" size="mini" shape="circle" @click="showCreateDept = true">
          <template #icon><icon-plus /></template>
        </a-button>
      </div>

      <!-- Company entry -->
      <div
        class="company-info"
        :class="{ active: selectedDeptId === null }"
        @click="selectedDeptId = null; selectedWorkerId = null"
      >
        <div class="company-logo">🏢</div>
        <div>
          <div class="company-name">{{ orgStore.company.name }}</div>
          <div class="company-desc">{{ orgStore.company.description }}</div>
        </div>
      </div>

      <a-divider style="margin: 8px 0" />

      <div class="dept-list">
        <div
          v-for="dept in orgStore.departments"
          :key="dept.id"
          class="dept-item"
          :class="{ active: selectedDeptId === dept.id }"
          @click="selectedDeptId = dept.id; selectedWorkerId = null"
        >
          <icon-team class="dept-icon" />
          <div class="dept-info">
            <div class="dept-name">{{ dept.name }}</div>
            <div class="dept-count">{{ dept.memberIds.length }} {{ t('org.members') }}</div>
          </div>
          <a-button
            type="text"
            size="mini"
            class="dept-del-btn"
            @click.stop="handleDeleteDept(dept.id)"
          >
            <template #icon><icon-delete /></template>
          </a-button>
        </div>
        <div v-if="orgStore.departments.length === 0" class="no-depts">
          {{ t('org.noDepartments') }}
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="org-main">
      <!-- Breadcrumb -->
      <div class="main-breadcrumb" v-if="selectedDeptId">
        <span class="bc-link" @click="selectedDeptId = null; selectedWorkerId = null">
          <icon-left />{{ orgStore.company.name }}
        </span>
        <icon-right class="bc-sep" />
        <span class="bc-current">{{ selectedDept?.name }}</span>
      </div>

      <!-- View header -->
      <div class="view-header">
        <div class="view-title-group">
          <div style="display:flex; align-items:center; gap:10px">
            <h2>{{ selectedDept ? selectedDept.name : orgStore.company.name }}</h2>
            <a-button type="text" size="mini" @click="openEditInfo">
              <template #icon><icon-edit /></template>
            </a-button>
          </div>
          <p class="view-desc">{{ selectedDept ? selectedDept.description : orgStore.company.description }}</p>
        </div>
        <div class="view-actions">
          <a-radio-group v-model="viewMode" type="button" size="small">
            <a-radio value="grid"><icon-apps /></a-radio>
            <a-radio value="list"><icon-list /></a-radio>
          </a-radio-group>
        </div>
      </div>

      <!-- Goals section -->
      <div class="goals-section">
        <div class="goals-header">
          <div class="goals-title">
            <span class="goals-icon">🎯</span>
            <span>{{ selectedDept ? t('org.deptGoals') : t('org.companyGoals') }}</span>
            <a-tag size="small" color="arcoblue">{{ currentGoals.length }}</a-tag>
          </div>
          <a-button size="small" @click="openAddGoal">
            <template #icon><icon-plus /></template>
            {{ t('org.addGoal') }}
          </a-button>
        </div>

        <div v-if="currentGoals.length === 0" class="goals-empty">{{ t('org.noGoals') }}</div>

        <div v-else class="goals-list">
          <div
            v-for="goal in currentGoals"
            :key="goal.id"
            class="goal-item"
            :class="`status-${goal.status}`"
          >
            <div class="goal-main">
              <div class="goal-status-dot" :class="goal.status"></div>
              <div class="goal-content">
                <div class="goal-title-row">
                  <span class="goal-title">{{ goal.title }}</span>
                  <div class="goal-badges">
                    <a-tag size="small" :color="priorityColor(goal.priority)">{{ t(`org.priority_${goal.priority}`) }}</a-tag>
                    <a-tag size="small" :color="statusColor(goal.status)">{{ t(`org.goalStatus_${goal.status}`) }}</a-tag>
                  </div>
                </div>
                <div class="goal-desc">{{ goal.description }}</div>
              </div>
            </div>
            <div class="goal-actions">
              <a-button type="text" size="mini" @click="openEditGoal(goal)">
                <template #icon><icon-edit /></template>
              </a-button>
              <a-button type="text" size="mini" status="danger" @click="handleDeleteGoal(goal.id)">
                <template #icon><icon-delete /></template>
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <a-divider style="margin: 12px 0" />

      <!-- Workers section header -->
      <div class="section-header">
        <span class="section-title">{{ t('org.members') }}（{{ displayWorkers.length }}）</span>
        <a-button v-if="selectedDeptId" size="small" @click="showAssignWorker = true">
          <template #icon><icon-plus /></template>
          {{ t('org.assignWorker') }}
        </a-button>
      </div>

      <!-- Worker grid -->
      <div v-if="viewMode === 'grid'" class="worker-grid">
        <div
          v-for="w in displayWorkers"
          :key="w.id"
          class="worker-card"
          :class="{ selected: selectedWorkerId === w.id }"
          @click="selectedWorkerId = w.id === selectedWorkerId ? null : w.id"
        >
          <div class="wc-avatar">{{ workerAvatar(w) }}</div>
          <div class="wc-name">{{ w.name }}</div>
          <div class="wc-role">{{ workerRoleLabel(w.role) }}</div>
          <div class="wc-status">
            <span class="status-dot" :class="w.status"></span>
            <span>{{ t(`workers.${w.status}`) }}</span>
          </div>
          <div class="wc-dept-tag">
            <a-tag v-if="getDeptName(w.id)" size="small" color="arcoblue">{{ getDeptName(w.id) }}</a-tag>
            <a-tag v-else size="small">{{ t('org.unassigned') }}</a-tag>
          </div>
          <div v-if="w.isPrimary" class="wc-primary-badge">
            <a-tag size="small" color="gold">⭐ 主要</a-tag>
          </div>
        </div>

        <div v-if="displayWorkers.length === 0" class="workers-empty">
          <icon-robot style="font-size:32px; color:var(--text-tertiary)" />
          <span>{{ selectedDeptId ? t('org.noDeptMembers') : t('org.noWorkers') }}</span>
        </div>
      </div>

      <!-- Worker list -->
      <a-table
        v-else
        :data="displayWorkers"
        :bordered="false"
        :stripe="true"
        row-key="id"
        :pagination="{ pageSize: 10, simple: true }"
        style="margin-top: 8px;"
      >
        <template #columns>
          <a-table-column title="" :width="50">
            <template #cell="{ record }">
              <span style="font-size:22px">{{ workerAvatar(record) }}</span>
            </template>
          </a-table-column>
          <a-table-column :title="t('workers.workerName')" data-index="name" />
          <a-table-column :title="t('org.employeeRole')">
            <template #cell="{ record }">{{ workerRoleLabel(record.role) }}</template>
          </a-table-column>
          <a-table-column :title="t('org.department')">
            <template #cell="{ record }">
              <a-tag v-if="getDeptName(record.id)" size="small" color="arcoblue">{{ getDeptName(record.id) }}</a-tag>
              <span v-else style="color:var(--text-tertiary)">—</span>
            </template>
          </a-table-column>
          <a-table-column :title="t('workers.workerStatus')">
            <template #cell="{ record }">
              <span class="status-dot" :class="record.status"></span>
              {{ t(`workers.${record.status}`) }}
            </template>
          </a-table-column>
          <a-table-column :title="t('common.actions')">
            <template #cell="{ record }">
              <a-button type="text" size="mini" @click="selectedWorkerId = record.id">
                <template #icon><icon-eye /></template>
              </a-button>
              <a-button type="text" size="mini" @click="openAssignSingle(record.id)">
                <template #icon><icon-swap /></template>
              </a-button>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <!-- Org chart (company level only) -->
      <div v-if="!selectedDeptId" class="org-overview">
        <h3 class="overview-title">{{ t('org.orgChart') }}</h3>
        <div class="org-tree">
          <div class="ot-root">
            <div class="ot-node root-node">
              <span class="ot-avatar">🏢</span>
              <strong>{{ orgStore.company.name }}</strong>
              <span class="ot-meta">{{ orgStore.departments.length }} 个部门</span>
            </div>
          </div>

          <div class="ot-children">
            <div
              v-for="(dept, dIdx) in orgStore.departments"
              :key="dept.id"
              class="ot-branch"
              :class="{ 'ot-last': dIdx === orgStore.departments.length - 1 }"
            >
              <div
                class="ot-node dept-node"
                :class="{ expanded: expandedDepts.has(dept.id) }"
                @click="toggleDept(dept.id)"
              >
                <span class="ot-expand">{{ expandedDepts.has(dept.id) ? '▾' : '▸' }}</span>
                <icon-team class="ot-icon" />
                <span class="ot-name">{{ dept.name }}</span>
                <span class="ot-meta">{{ dept.memberIds.length }} 人</span>
                <a-tag v-if="dept.goals.filter(g => g.status === 'active').length > 0" size="small" color="blue" style="margin-left:4px">
                  🎯 {{ dept.goals.filter(g => g.status === 'active').length }}
                </a-tag>
                <a-button type="text" size="mini" class="dept-nav-btn" @click.stop="selectedDeptId = dept.id">
                  <template #icon><icon-right /></template>
                </a-button>
              </div>

              <transition name="tree-slide">
                <div v-if="expandedDepts.has(dept.id)" class="ot-children member-children">
                  <div
                    v-for="(wId, eIdx) in dept.memberIds"
                    :key="wId"
                    class="ot-branch"
                    :class="{ 'ot-last': eIdx === dept.memberIds.length - 1 }"
                  >
                    <div class="ot-node member-node" @click="selectedWorkerId = wId">
                      <span class="ot-avatar">{{ workerAvatar(getWorker(wId)) }}</span>
                      <span class="ot-name">{{ getWorker(wId)?.name ?? wId }}</span>
                      <span class="ot-role">· {{ workerRoleLabel(getWorker(wId)?.role) }}</span>
                      <span class="status-dot sm" :class="getWorker(wId)?.status"></span>
                    </div>
                  </div>
                  <div v-if="dept.memberIds.length === 0" class="ot-branch">
                    <div class="ot-node member-node" style="color:var(--text-tertiary); cursor:default">
                      暂无成员
                    </div>
                  </div>
                </div>
              </transition>
            </div>
          </div>

          <!-- Unassigned workers -->
          <div v-if="unassignedWorkers.length > 0" class="unassigned-block">
            <div class="ua-title">未分配部门（{{ unassignedWorkers.length }}）</div>
            <div class="ua-chips">
              <a-tag
                v-for="w in unassignedWorkers"
                :key="w.id"
                size="small"
                @click="openAssignSingle(w.id)"
                style="cursor:pointer"
              >
                {{ workerAvatar(w) }} {{ w.name }}
              </a-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Worker detail drawer -->
    <a-drawer
      v-if="selectedWorker"
      :visible="!!selectedWorkerId"
      :title="selectedWorker.name"
      :width="340"
      @cancel="selectedWorkerId = null"
      :footer="false"
    >
      <div class="worker-detail">
        <div class="wd-avatar">{{ workerAvatar(selectedWorker) }}</div>
        <h2>{{ selectedWorker.name }}</h2>
        <p class="wd-role">{{ workerRoleLabel(selectedWorker.role) }}</p>
        <a-divider />
        <div class="wd-row">
          <span class="status-dot" :class="selectedWorker.status"></span>
          {{ t(`workers.${selectedWorker.status}`) }}
        </div>
        <div class="wd-row" v-if="getDeptName(selectedWorker.id)">
          <icon-team />{{ getDeptName(selectedWorker.id) }}
        </div>
        <div class="wd-row" v-if="selectedWorker.modelId">
          🤖 {{ selectedWorker.modelId }}
        </div>
        <div class="wd-row" v-if="selectedWorker.skills?.length">
          🔧 {{ selectedWorker.skills.join(', ') }}
        </div>
        <a-divider />
        <div class="wd-assign-section">
          <div class="wd-assign-label">所属部门</div>
          <a-select
            :model-value="orgStore.getWorkerDept(selectedWorker.id)"
            allow-clear
            :placeholder="t('org.unassigned')"
            style="width:100%"
            @change="(v: string | null) => orgStore.assignWorker(selectedWorker!.id, v ?? null)"
          >
            <a-option v-for="d in orgStore.departments" :key="d.id" :value="d.id">{{ d.name }}</a-option>
          </a-select>
        </div>
      </div>
    </a-drawer>

    <!-- Create department modal -->
    <a-modal
      v-model:visible="showCreateDept"
      :title="t('org.createDepartment')"
      @ok="handleCreateDept"
      @cancel="showCreateDept = false"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('org.departmentName')">
          <a-input v-model="newDept.name" :placeholder="t('org.departmentNamePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('common.description')">
          <a-input v-model="newDept.description" :placeholder="t('org.departmentDescPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Edit company/dept info modal -->
    <a-modal
      v-model:visible="showEditInfo"
      :title="selectedDeptId ? t('org.editDepartment') : t('org.editCompany')"
      @ok="handleSaveInfo"
      @cancel="showEditInfo = false"
    >
      <a-form layout="vertical">
        <a-form-item :label="selectedDeptId ? t('org.departmentName') : t('org.companyName')">
          <a-input v-model="editInfoForm.name" />
        </a-form-item>
        <a-form-item :label="t('common.description')">
          <a-textarea v-model="editInfoForm.description" :auto-size="{ minRows: 2 }" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Assign workers to dept modal -->
    <a-modal
      v-model:visible="showAssignWorker"
      :title="t('org.assignWorker')"
      @ok="handleBatchAssign"
      @cancel="showAssignWorker = false"
    >
      <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px">
        选择要加入「{{ selectedDept?.name }}」的 Worker
      </p>
      <a-checkbox-group v-model="assignSelection" style="display:flex; flex-direction:column; gap:8px">
        <a-checkbox v-for="w in workersStore.workers" :key="w.id" :value="w.id">
          {{ workerAvatar(w) }} {{ w.name }}
          <a-tag v-if="getDeptName(w.id)" size="small" color="arcoblue" style="margin-left:6px">{{ getDeptName(w.id) }}</a-tag>
        </a-checkbox>
      </a-checkbox-group>
    </a-modal>

    <!-- Goal modal -->
    <a-modal
      v-model:visible="showGoalModal"
      :title="editingGoalId ? t('org.editGoal') : t('org.addGoal')"
      @ok="handleSaveGoal"
      @cancel="showGoalModal = false"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('org.goalTitle')">
          <a-input v-model="goalForm.title" :placeholder="t('org.goalTitlePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('common.description')">
          <a-textarea v-model="goalForm.description" :placeholder="t('org.goalDescPlaceholder')" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </a-form-item>
        <a-form-item :label="t('org.goalPriority')">
          <a-select v-model="goalForm.priority">
            <a-option value="high">{{ t('org.priority_high') }}</a-option>
            <a-option value="medium">{{ t('org.priority_medium') }}</a-option>
            <a-option value="low">{{ t('org.priority_low') }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('org.goalStatus')">
          <a-select v-model="goalForm.status">
            <a-option value="active">{{ t('org.goalStatus_active') }}</a-option>
            <a-option value="paused">{{ t('org.goalStatus_paused') }}</a-option>
            <a-option value="completed">{{ t('org.goalStatus_completed') }}</a-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorkersStore } from '@/stores/workers';
import { useOrgStore, type OrgGoal } from '@/stores/org';
import type { ApiWorker } from '@/api/client';
import { Message } from '@arco-design/web-vue';

const { t } = useI18n();
const workersStore = useWorkersStore();
const orgStore = useOrgStore();

onMounted(() => { void workersStore.fetchWorkers(); });

const selectedDeptId    = ref<string | null>(null);
const selectedWorkerId  = ref<string | null>(null);
const viewMode          = ref<'grid' | 'list'>('grid');
const expandedDepts     = ref<Set<string>>(new Set());

const showCreateDept    = ref(false);
const showEditInfo      = ref(false);
const showAssignWorker  = ref(false);
const showGoalModal     = ref(false);
const assignSelection   = ref<string[]>([]);

const newDept = reactive({ name: '', description: '' });
const editInfoForm = reactive({ name: '', description: '' });

const editingGoalId = ref<string | null>(null);
const goalForm = reactive({ title: '', description: '', priority: 'medium' as OrgGoal['priority'], status: 'active' as OrgGoal['status'] });

// ── Computed ───────────────────────────────────────────────────────────────

const selectedDept = computed(() =>
  selectedDeptId.value ? orgStore.departments.find(d => d.id === selectedDeptId.value) : null
);

const selectedWorker = computed(() =>
  selectedWorkerId.value ? workersStore.workers.find(w => w.id === selectedWorkerId.value) : null
);

const displayWorkers = computed(() => {
  if (selectedDept.value) {
    return selectedDept.value.memberIds
      .map(id => workersStore.workers.find(w => w.id === id))
      .filter((w): w is ApiWorker => !!w);
  }
  return workersStore.workers;
});

const unassignedWorkers = computed(() =>
  workersStore.workers.filter(w => !orgStore.getWorkerDept(w.id))
);

const currentGoals = computed<OrgGoal[]>(() =>
  selectedDept.value ? selectedDept.value.goals : orgStore.company.goals
);

const currentTargetId = computed(() => selectedDeptId.value ?? 'company');

// ── Helpers ────────────────────────────────────────────────────────────────

function getWorker(id: string): ApiWorker | undefined {
  return workersStore.workers.find(w => w.id === id);
}

function getDeptName(workerId: string): string | null {
  const deptId = orgStore.getWorkerDept(workerId);
  return deptId ? (orgStore.departments.find(d => d.id === deptId)?.name ?? null) : null;
}

const ROLE_AVATARS: Record<string, string> = {
  secretary: '🤵', research: '🔬', code: '💻', writer: '✍️', data: '📊',
};

function workerAvatar(w: ApiWorker | undefined): string {
  if (!w) return '🤖';
  for (const [k, v] of Object.entries(ROLE_AVATARS)) {
    if (w.id.includes(k) || w.name.includes(k)) return v;
  }
  return '🤖';
}

function workerRoleLabel(role: string | undefined): string {
  if (!role) return '';
  // Extract first sentence or truncate long system prompts
  const first = role.split('。')[0]?.split('.')[0] ?? role;
  return first.length > 30 ? first.slice(0, 30) + '…' : first;
}

function toggleDept(deptId: string) {
  const s = new Set(expandedDepts.value);
  s.has(deptId) ? s.delete(deptId) : s.add(deptId);
  expandedDepts.value = s;
}

function priorityColor(p: OrgGoal['priority']) {
  return { high: 'red', medium: 'orange', low: 'green' }[p];
}

function statusColor(s: OrgGoal['status']) {
  return { active: 'arcoblue', completed: 'green', paused: 'gray' }[s];
}

// ── Actions ────────────────────────────────────────────────────────────────

function handleCreateDept() {
  if (!newDept.name) return;
  orgStore.createDepartment(newDept.name, newDept.description);
  Object.assign(newDept, { name: '', description: '' });
  showCreateDept.value = false;
  Message.success(t('common.success'));
}

function handleDeleteDept(id: string) {
  orgStore.deleteDepartment(id);
  if (selectedDeptId.value === id) selectedDeptId.value = null;
}

function openEditInfo() {
  if (selectedDept.value) {
    Object.assign(editInfoForm, { name: selectedDept.value.name, description: selectedDept.value.description });
  } else {
    Object.assign(editInfoForm, { name: orgStore.company.name, description: orgStore.company.description });
  }
  showEditInfo.value = true;
}

function handleSaveInfo() {
  if (selectedDeptId.value) {
    orgStore.updateDepartment(selectedDeptId.value, { name: editInfoForm.name, description: editInfoForm.description });
  } else {
    orgStore.updateCompany({ name: editInfoForm.name, description: editInfoForm.description });
  }
  showEditInfo.value = false;
  Message.success(t('common.success'));
}

function openAssignSingle(workerId: string) {
  selectedWorkerId.value = workerId;
}

function handleBatchAssign() {
  if (!selectedDeptId.value) return;
  for (const wId of assignSelection.value) {
    orgStore.assignWorker(wId, selectedDeptId.value);
  }
  assignSelection.value = [];
  showAssignWorker.value = false;
  Message.success(t('common.success'));
}

// ── Goals ──────────────────────────────────────────────────────────────────

function openAddGoal() {
  editingGoalId.value = null;
  Object.assign(goalForm, { title: '', description: '', priority: 'medium', status: 'active' });
  showGoalModal.value = true;
}

function openEditGoal(goal: OrgGoal) {
  editingGoalId.value = goal.id;
  Object.assign(goalForm, { title: goal.title, description: goal.description, priority: goal.priority, status: goal.status });
  showGoalModal.value = true;
}

function handleSaveGoal() {
  if (!goalForm.title) return;
  if (editingGoalId.value) {
    orgStore.updateGoal(currentTargetId.value, editingGoalId.value, { ...goalForm });
  } else {
    orgStore.addGoal(currentTargetId.value, { ...goalForm });
  }
  showGoalModal.value = false;
  Message.success(t('common.success'));
}

function handleDeleteGoal(goalId: string) {
  orgStore.deleteGoal(currentTargetId.value, goalId);
}
</script>

<style scoped>
.org-view {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* ─── Sub Panel ──────────────────────────────────────────────────────── */

.sub-panel {
  width: var(--subpanel-width);
  min-width: var(--subpanel-width);
  height: 100%;
  background: var(--bg-subpanel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.company-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 12px;
  border-radius: 8px;
  margin: 0 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.company-info:hover,
.company-info.active { background: rgba(22,93,255,0.08); }

.company-logo { font-size: 30px; flex-shrink: 0; }
.company-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.company-desc { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

.dept-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.dept-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
  color: var(--text-secondary);
  position: relative;
}

.dept-item:hover { background: rgba(22, 93, 255, 0.05); color: var(--text-primary); }
.dept-item.active { background: rgba(22, 93, 255, 0.1); color: #165dff; }

.dept-icon { font-size: 18px; flex-shrink: 0; }
.dept-info { min-width: 0; flex: 1; }
.dept-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dept-count { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }

.dept-del-btn { opacity: 0; transition: opacity 0.15s; }
.dept-item:hover .dept-del-btn { opacity: 1; }

.no-depts {
  text-align: center;
  padding: 20px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ─── Main ───────────────────────────────────────────────────────────── */

.org-main {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 24px;
  background: var(--bg-card);
}

.main-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 0 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.bc-link {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #165dff;
  cursor: pointer;
  font-weight: 500;
}
.bc-link:hover { text-decoration: underline; }
.bc-sep { font-size: 14px; color: var(--text-tertiary); }
.bc-current { font-weight: 600; color: var(--text-primary); }

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 0 12px;
}

.view-title-group h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.view-desc { font-size: 13px; color: var(--text-secondary); }

.view-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ─── Goals ──────────────────────────────────────────────────────────── */

.goals-section {
  background: var(--bg-base);
  border-radius: 14px;
  border: 1px solid var(--border-color);
  padding: 14px 16px;
  margin-bottom: 16px;
}

.goals-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.goals-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.goals-icon { font-size: 16px; }
.goals-empty { text-align: center; padding: 14px 0; font-size: 13px; color: var(--text-tertiary); }

.goals-list { display: flex; flex-direction: column; gap: 8px; }

.goal-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  transition: all 0.15s;
}
.goal-item:hover { border-color: rgba(22,93,255,0.3); box-shadow: 0 1px 6px rgba(22,93,255,0.08); }
.goal-item.status-completed { opacity: 0.65; }

.goal-main { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }

.goal-status-dot {
  width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0;
}
.goal-status-dot.active    { background: #00b42a; }
.goal-status-dot.paused    { background: #ff7d00; }
.goal-status-dot.completed { background: #86909c; }

.goal-content { flex: 1; min-width: 0; }
.goal-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.goal-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.goal-badges { display: flex; gap: 4px; }
.goal-desc { font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.goal-actions { display: flex; gap: 2px; flex-shrink: 0; margin-left: 8px; }

/* ─── Section header ─────────────────────────────────────────────────── */

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ─── Worker Grid ────────────────────────────────────────────────────── */

.worker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}

.worker-card {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}
.worker-card:hover { border-color: var(--border-color); box-shadow: var(--shadow-sm); }
.worker-card.selected { border-color: #165dff; background: rgba(22,93,255,0.04); }

.wc-avatar { font-size: 40px; margin-bottom: 10px; }
.wc-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.wc-role { font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
.wc-status {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.wc-dept-tag { margin-top: 8px; }
.wc-primary-badge { margin-top: 6px; }

.workers-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* Status dot */
.status-dot {
  display: inline-block;
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.status-dot.sm { width: 6px; height: 6px; }
.status-dot.online  { background: #00b42a; }
.status-dot.idle    { background: #ff7d00; }
.status-dot.offline { background: #86909c; }

/* ─── Org Tree ───────────────────────────────────────────────────────── */

.org-overview {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

.overview-title {
  font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;
}

.org-tree { font-size: 14px; }

.ot-root { margin-bottom: 4px; }

.ot-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.root-node {
  cursor: default;
  background: linear-gradient(135deg, rgba(22,93,255,0.06), rgba(114,46,209,0.06));
  border-color: rgba(22,93,255,0.2);
  font-size: 15px;
}
.root-node .ot-avatar { font-size: 22px; }

.ot-children {
  margin-left: 24px;
  border-left: 1.5px solid var(--border-color);
}

.member-children { border-left-color: rgba(22,93,255,0.2); }

.ot-branch { position: relative; padding: 4px 0 4px 20px; }
.ot-branch::before {
  content: ''; position: absolute; left: 0; top: 20px;
  width: 20px; height: 1.5px; background: var(--border-color);
}
.member-children > .ot-branch::before { background: rgba(22,93,255,0.2); }

.dept-node { color: var(--text-primary); gap: 7px; }
.dept-node:hover { background: rgba(22,93,255,0.06); border-color: #165dff; }
.dept-node.expanded { background: rgba(22,93,255,0.08); border-color: rgba(22,93,255,0.4); color: #165dff; }

.ot-expand { font-size: 12px; width: 14px; text-align: center; color: var(--text-tertiary); flex-shrink: 0; }
.ot-icon { font-size: 15px; color: inherit; }
.ot-name { font-weight: 500; }
.ot-meta { font-size: 11px; color: var(--text-tertiary); margin-left: 4px; }
.ot-role { font-size: 12px; color: var(--text-tertiary); }
.ot-avatar { font-size: 18px; }

.dept-nav-btn { opacity: 0; transition: opacity 0.15s; margin-left: 4px; }
.dept-node:hover .dept-nav-btn { opacity: 1; }

.member-node {
  border-color: rgba(22,93,255,0.1); background: var(--bg-card); color: var(--text-secondary); gap: 8px;
}
.member-node:hover {
  background: rgba(22,93,255,0.04); border-color: rgba(22,93,255,0.2); color: var(--text-primary);
}

/* Unassigned block */
.unassigned-block {
  margin-top: 20px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px dashed var(--border-color);
}
.ua-title { font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px; }
.ua-chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* Tree expand animation */
.tree-slide-enter-active { transition: all 0.2s ease; overflow: hidden; }
.tree-slide-leave-active { transition: all 0.15s ease; overflow: hidden; }
.tree-slide-enter-from,
.tree-slide-leave-to { opacity: 0; transform: translateY(-6px); }

/* ─── Worker Drawer ──────────────────────────────────────────────────── */

.worker-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
}

.wd-avatar { font-size: 60px; margin-bottom: 8px; }
.worker-detail h2 { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.wd-role { color: var(--text-secondary); font-size: 13px; text-align: center; }

.wd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  width: 100%;
  padding: 4px 0;
}

.wd-assign-section { width: 100%; }
.wd-assign-label { font-size: 12px; color: var(--text-tertiary); margin-bottom: 6px; }
</style>
