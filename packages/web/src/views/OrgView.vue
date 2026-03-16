<template>
  <div class="org-view">
    <!-- Sub panel: recursive org tree -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.org') }}</span>
      </div>

      <div class="tree-container">
        <OrgTreeNode
          :node="orgStore.root"
          :depth="0"
          :selected-id="selectedId"
          @select="selectedId = $event; selectedWorkerId = null"
          @add-child="openAddChild($event)"
        />
      </div>
    </div>

    <!-- Main content -->
    <div class="org-main" v-if="currentNode">
      <!-- Breadcrumb -->
      <div class="breadcrumb" v-if="breadcrumb.length > 1">
        <template v-for="(n, i) in breadcrumb" :key="n.id">
          <span
            class="bc-item"
            :class="{ last: i === breadcrumb.length - 1 }"
            @click="selectedId = n.id"
          >{{ nodeTypeIcon(n.type) }} {{ n.name }}</span>
          <span v-if="i < breadcrumb.length - 1" class="bc-sep">/</span>
        </template>
      </div>

      <!-- Node header -->
      <div class="node-header">
        <div class="nh-left">
          <span class="nh-icon">{{ nodeTypeIcon(currentNode.type) }}</span>
          <div>
            <div class="nh-title-row">
              <h2>{{ currentNode.name }}</h2>
              <a-tag size="small" color="arcoblue">{{ nodeTypeLabel(currentNode.type) }}</a-tag>
              <a-button type="text" size="mini" @click="openEditNode">
                <template #icon><icon-edit /></template>
              </a-button>
              <a-button
                v-if="currentNode.id !== 'root'"
                type="text"
                size="mini"
                status="danger"
                @click="handleDeleteNode"
              >
                <template #icon><icon-delete /></template>
              </a-button>
            </div>
            <p class="nh-desc">{{ currentNode.description || '暂无描述' }}</p>
          </div>
        </div>
        <div class="nh-actions">
          <a-button @click="openAddChild(currentNode.id)">
            <template #icon><icon-plus /></template>
            {{ t('org.addSubUnit') }}
          </a-button>
        </div>
      </div>

      <!-- Leader -->
      <div class="leader-section" v-if="currentNode.id !== 'root'">
        <span class="leader-label">{{ t('org.leader') }}：</span>
        <a-select
          :model-value="currentNode.leaderId ?? null"
          allow-clear
          size="small"
          style="width:200px"
          :placeholder="t('org.noLeader')"
          @change="(v: string | null) => orgStore.setLeader(currentNode!.id, v)"
        >
          <a-option v-for="w in currentNodeWorkers" :key="w.id" :value="w.id">
            🤖 {{ w.name }}
          </a-option>
        </a-select>
        <a-tag v-if="leaderWorker" color="gold" size="small">⭐ {{ leaderWorker.name }}</a-tag>
      </div>

      <!-- Goals section -->
      <div class="goals-section">
        <div class="goals-header">
          <div class="goals-title">
            <span>🎯</span>
            <span>{{ t('org.companyGoals') }}</span>
            <a-tag size="small" color="arcoblue">{{ currentNode.goals.length }}</a-tag>
          </div>
          <a-button size="small" @click="openAddGoal">
            <template #icon><icon-plus /></template>
            {{ t('org.addGoal') }}
          </a-button>
        </div>

        <div v-if="currentNode.goals.length === 0" class="goals-empty">{{ t('org.noGoals') }}</div>
        <div v-else class="goals-list">
          <div
            v-for="goal in currentNode.goals"
            :key="goal.id"
            class="goal-item"
            :class="`status-${goal.status}`"
          >
            <div class="goal-main">
              <div class="goal-status-dot" :class="goal.status"></div>
              <div class="goal-content">
                <div class="goal-title-row">
                  <span class="goal-title">{{ goal.title }}</span>
                  <a-tag size="small" :color="priorityColor(goal.priority)">{{ t(`org.priority_${goal.priority}`) }}</a-tag>
                  <a-tag size="small" :color="statusColor(goal.status)">{{ t(`org.goalStatus_${goal.status}`) }}</a-tag>
                </div>
                <div class="goal-desc">{{ goal.description }}</div>
              </div>
            </div>
            <div class="goal-actions">
              <a-button type="text" size="mini" @click="openEditGoal(goal)">
                <template #icon><icon-edit /></template>
              </a-button>
              <a-button type="text" size="mini" status="danger" @click="orgStore.deleteGoal(currentNode.id, goal.id)">
                <template #icon><icon-delete /></template>
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Sub-units -->
      <div v-if="currentNode.children.length > 0" class="sub-units-section">
        <div class="section-title">
          {{ t('org.subUnits') }}（{{ currentNode.children.length }}）
        </div>
        <div class="sub-units-grid">
          <div
            v-for="child in currentNode.children"
            :key="child.id"
            class="sub-unit-card"
            @click="selectedId = child.id"
          >
            <div class="suc-icon">{{ nodeTypeIcon(child.type) }}</div>
            <div class="suc-name">{{ child.name }}</div>
            <div class="suc-meta">
              <a-tag size="small" color="arcoblue">{{ nodeTypeLabel(child.type) }}</a-tag>
              <span class="suc-count">{{ totalMembers(child) }} 人</span>
            </div>
            <div class="suc-goals" v-if="child.goals.filter(g => g.status === 'active').length > 0">
              🎯 {{ child.goals.filter(g => g.status === 'active').length }} 个目标
            </div>
          </div>
        </div>
      </div>

      <!-- Members section -->
      <div class="members-section">
        <div class="section-header">
          <span class="section-title">{{ t('org.members') }}（{{ currentNodeWorkers.length }}）</span>
          <div class="section-actions">
            <a-radio-group v-model="viewMode" type="button" size="small">
              <a-radio value="grid"><icon-apps /></a-radio>
              <a-radio value="list"><icon-list /></a-radio>
            </a-radio-group>
            <a-button size="small" @click="showAssignWorker = true">
              <template #icon><icon-plus /></template>
              {{ t('org.assignWorker') }}
            </a-button>
          </div>
        </div>

        <!-- Worker grid -->
        <div v-if="viewMode === 'grid'" class="worker-grid">
          <div
            v-for="w in currentNodeWorkers"
            :key="w.id"
            class="worker-card"
            :class="{ selected: selectedWorkerId === w.id, leader: currentNode.leaderId === w.id }"
            @click="selectedWorkerId = w.id === selectedWorkerId ? null : w.id"
          >
            <div class="wc-leader-crown" v-if="currentNode.leaderId === w.id">👑</div>
            <div class="wc-avatar">{{ workerAvatar(w) }}</div>
            <div class="wc-name">{{ w.name }}</div>
            <div class="wc-role">{{ workerRoleLabel(w.role) }}</div>
            <div class="wc-status">
              <span class="status-dot" :class="w.status"></span>
              <span>{{ t(`workers.${w.status}`) }}</span>
            </div>
            <div class="wc-model">{{ w.modelId }}</div>
          </div>
          <div v-if="currentNodeWorkers.length === 0" class="members-empty">
            <span>{{ t('org.noDeptMembers') }}</span>
            <a-button size="small" type="text" @click="showAssignWorker = true">
              + {{ t('org.assignWorker') }}
            </a-button>
          </div>
        </div>

        <!-- Worker list -->
        <a-table
          v-else
          :data="currentNodeWorkers"
          :bordered="false"
          :stripe="true"
          row-key="id"
          :pagination="{ pageSize: 10, simple: true }"
          style="margin-top: 8px;"
        >
          <template #columns>
            <a-table-column title="" :width="50">
              <template #cell="{ record }">
                <span style="font-size:20px">{{ workerAvatar(record) }}</span>
              </template>
            </a-table-column>
            <a-table-column :title="t('workers.workerName')" data-index="name">
              <template #cell="{ record }">
                <span>{{ record.name }}</span>
                <a-tag v-if="currentNode.leaderId === record.id" size="small" color="gold" style="margin-left:6px">👑 负责人</a-tag>
              </template>
            </a-table-column>
            <a-table-column :title="t('workers.workerStatus')">
              <template #cell="{ record }">
                <span class="status-dot" :class="record.status"></span>
                {{ t(`workers.${record.status}`) }}
              </template>
            </a-table-column>
            <a-table-column title="Model" data-index="modelId" />
            <a-table-column :title="t('common.actions')">
              <template #cell="{ record }">
                <a-button type="text" size="mini" @click="selectedWorkerId = record.id">
                  <template #icon><icon-eye /></template>
                </a-button>
                <a-button
                  type="text"
                  size="mini"
                  :title="currentNode.leaderId === record.id ? '取消负责人' : '设为负责人'"
                  @click="orgStore.setLeader(currentNode!.id, currentNode!.leaderId === record.id ? null : record.id)"
                >
                  <template #icon><icon-star /></template>
                </a-button>
                <a-button
                  type="text"
                  size="mini"
                  status="danger"
                  @click="orgStore.assignWorker(record.id, null)"
                >
                  <template #icon><icon-minus /></template>
                </a-button>
              </template>
            </a-table-column>
          </template>
        </a-table>
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
        <div class="wd-row" v-if="workerNodePath(selectedWorker.id)">
          📍 {{ workerNodePath(selectedWorker.id) }}
        </div>
        <div class="wd-row">🤖 {{ selectedWorker.modelId }}</div>
        <div class="wd-row" v-if="selectedWorker.skills?.length">
          🔧 {{ selectedWorker.skills.join(', ') }}
        </div>
        <a-divider />
        <div class="wd-assign-section">
          <div class="wd-assign-label">所属节点</div>
          <a-tree-select
            :model-value="orgStore.getWorkerNodeId(selectedWorker.id)"
            :data="treeSelectData"
            allow-clear
            placeholder="未分配"
            style="width:100%"
            @change="(v: string | null) => orgStore.assignWorker(selectedWorker!.id, v ?? null)"
          />
        </div>
      </div>
    </a-drawer>

    <!-- Add/edit node modal -->
    <a-modal
      v-model:visible="showNodeModal"
      :title="nodeModalMode === 'add' ? t('org.addSubUnit') : t('org.editNode')"
      @ok="handleSaveNode"
      @cancel="showNodeModal = false"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('common.name')">
          <a-input v-model="nodeForm.name" :placeholder="t('org.nodeNamePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('org.nodeType')">
          <a-select v-model="nodeForm.type" allow-create>
            <a-option v-for="opt in NODE_TYPE_OPTIONS.filter(o => o.value !== 'root')" :key="opt.value" :value="opt.value">
              {{ opt.icon }} {{ opt.label }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('common.description')">
          <a-textarea v-model="nodeForm.description" :auto-size="{ minRows: 2 }" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Assign workers modal -->
    <a-modal
      v-model:visible="showAssignWorker"
      :title="`分配 Worker 到「${currentNode?.name}」`"
      @ok="handleBatchAssign"
      @cancel="showAssignWorker = false"
    >
      <p style="font-size:12px; color:var(--text-secondary); margin-bottom:12px">
        勾选后，Worker 将从原位置移动到此节点
      </p>
      <a-checkbox-group v-model="assignSelection" style="display:flex; flex-direction:column; gap:8px">
        <a-checkbox v-for="w in workersStore.workers" :key="w.id" :value="w.id">
          {{ workerAvatar(w) }} {{ w.name }}
          <span v-if="orgStore.getWorkerNodeId(w.id)" style="font-size:11px; color:var(--text-tertiary); margin-left:4px">
            → {{ getNodeName(orgStore.getWorkerNodeId(w.id)) }}
          </span>
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
import { useOrgStore, NODE_TYPE_OPTIONS, nodeTypeIcon, nodeTypeLabel, totalMembers, type OrgGoal } from '@/stores/org';
import type { ApiWorker } from '@/api/client';
import { Message } from '@arco-design/web-vue';
import OrgTreeNode from '@/components/OrgTreeNode.vue';

const { t } = useI18n();
const workersStore = useWorkersStore();
const orgStore = useOrgStore();

onMounted(() => { void workersStore.fetchWorkers(); });

const selectedId        = ref<string>('root');
const selectedWorkerId  = ref<string | null>(null);
const viewMode          = ref<'grid' | 'list'>('grid');

const showNodeModal     = ref(false);
const showAssignWorker  = ref(false);
const showGoalModal     = ref(false);
const nodeModalMode     = ref<'add' | 'edit'>('add');
const addChildParentId  = ref<string | null>(null);
const assignSelection   = ref<string[]>([]);

const nodeForm = reactive({ name: '', description: '', type: 'department' });
const editingGoalId = ref<string | null>(null);
const goalForm = reactive({
  title: '', description: '',
  priority: 'medium' as OrgGoal['priority'],
  status: 'active' as OrgGoal['status'],
});

// ── Computed ───────────────────────────────────────────────────────────────

const currentNode = computed(() => orgStore.node(selectedId.value) ?? orgStore.root);

const breadcrumb = computed(() => orgStore.path(selectedId.value));

const currentNodeWorkers = computed((): ApiWorker[] => {
  if (!currentNode.value) return [];
  return currentNode.value.memberIds
    .map(id => workersStore.workers.find(w => w.id === id))
    .filter((w): w is ApiWorker => !!w);
});

const leaderWorker = computed(() =>
  currentNode.value?.leaderId
    ? workersStore.workers.find(w => w.id === currentNode.value!.leaderId)
    : null
);

const selectedWorker = computed(() =>
  selectedWorkerId.value ? workersStore.workers.find(w => w.id === selectedWorkerId.value) : null
);

/** TreeSelect data for worker drawer */
const treeSelectData = computed(() => {
  function toTree(n: typeof orgStore.root): object {
    return { key: n.id, title: `${nodeTypeIcon(n.type)} ${n.name}`, children: n.children.map(toTree) };
  }
  return [toTree(orgStore.root)];
});

// ── Helpers ────────────────────────────────────────────────────────────────

function workerNodePath(workerId: string): string {
  const nodeId = orgStore.getWorkerNodeId(workerId);
  if (!nodeId) return '';
  return orgStore.path(nodeId).map(n => n.name).join(' › ');
}

function getNodeName(nodeId: string | null): string {
  if (!nodeId) return '';
  return orgStore.node(nodeId)?.name ?? nodeId;
}

const ROLE_AVATARS: [string, string][] = [
  ['secretary', '🤵'], ['research', '🔬'], ['code', '💻'], ['writer', '✍️'], ['data', '📊'],
];

function workerAvatar(w: ApiWorker | undefined): string {
  if (!w) return '🤖';
  for (const [k, v] of ROLE_AVATARS) {
    if (w.id.includes(k) || w.name.includes(k)) return v;
  }
  return '🤖';
}

function workerRoleLabel(role: string | undefined): string {
  if (!role) return '';
  const first = role.split('。')[0]?.split('.')[0] ?? role;
  return first.length > 28 ? first.slice(0, 28) + '…' : first;
}

function priorityColor(p: OrgGoal['priority']) {
  return { high: 'red', medium: 'orange', low: 'green' }[p];
}

function statusColor(s: OrgGoal['status']) {
  return { active: 'arcoblue', completed: 'green', paused: 'gray' }[s];
}

// ── Node actions ───────────────────────────────────────────────────────────

function openAddChild(parentId: string) {
  addChildParentId.value = parentId;
  nodeModalMode.value = 'add';
  Object.assign(nodeForm, { name: '', description: '', type: 'department' });
  showNodeModal.value = true;
}

function openEditNode() {
  nodeModalMode.value = 'edit';
  Object.assign(nodeForm, {
    name: currentNode.value?.name ?? '',
    description: currentNode.value?.description ?? '',
    type: currentNode.value?.type ?? 'department',
  });
  showNodeModal.value = true;
}

function handleSaveNode() {
  if (!nodeForm.name) return;
  if (nodeModalMode.value === 'add') {
    const child = orgStore.addChild(addChildParentId.value, { ...nodeForm });
    selectedId.value = child.id;
  } else {
    orgStore.updateNode(currentNode.value!.id, { ...nodeForm });
  }
  showNodeModal.value = false;
  Message.success(t('common.success'));
}

function handleDeleteNode() {
  const parentPath = orgStore.path(currentNode.value!.id);
  orgStore.deleteNode(currentNode.value!.id);
  // Navigate to parent
  selectedId.value = parentPath[parentPath.length - 2]?.id ?? 'root';
  Message.success(t('common.success'));
}

function handleBatchAssign() {
  if (!currentNode.value) return;
  for (const wId of assignSelection.value) {
    orgStore.assignWorker(wId, currentNode.value.id);
  }
  assignSelection.value = [];
  showAssignWorker.value = false;
  Message.success(t('common.success'));
}

// ── Goal actions ───────────────────────────────────────────────────────────

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
  if (!goalForm.title || !currentNode.value) return;
  if (editingGoalId.value) {
    orgStore.updateGoal(currentNode.value.id, editingGoalId.value, { ...goalForm });
  } else {
    orgStore.addGoal(currentNode.value.id, { ...goalForm });
  }
  showGoalModal.value = false;
  Message.success(t('common.success'));
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
  flex-shrink: 0;
}

.sub-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }

.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
}

/* ─── Main ───────────────────────────────────────────────────────────── */

.org-main {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 40px;
  background: var(--bg-card);
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 14px 0 4px;
  font-size: 12px;
}

.bc-item {
  color: #165dff;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.12s;
}
.bc-item:hover { background: rgba(22,93,255,0.08); }
.bc-item.last { color: var(--text-primary); font-weight: 600; cursor: default; }
.bc-item.last:hover { background: none; }
.bc-sep { color: var(--text-tertiary); }

/* Node header */
.node-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 0 16px;
  gap: 16px;
}

.nh-left {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  flex: 1;
  min-width: 0;
}

.nh-icon { font-size: 36px; flex-shrink: 0; margin-top: 2px; }

.nh-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.nh-title-row h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.nh-desc { font-size: 13px; color: var(--text-secondary); margin: 0; }

.nh-actions { display: flex; gap: 8px; flex-shrink: 0; padding-top: 4px; }

/* Leader */
.leader-section {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-base);
  border-radius: 10px;
  border: 1px solid var(--border-color);
  margin-bottom: 16px;
  font-size: 13px;
}

.leader-label { color: var(--text-secondary); flex-shrink: 0; }

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

.goals-empty { text-align: center; padding: 12px 0; font-size: 13px; color: var(--text-tertiary); }

.goals-list { display: flex; flex-direction: column; gap: 8px; }

.goal-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  transition: border-color 0.15s;
}
.goal-item:hover { border-color: rgba(22,93,255,0.3); }
.goal-item.status-completed { opacity: 0.65; }

.goal-main { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }

.goal-status-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.goal-status-dot.active    { background: #00b42a; }
.goal-status-dot.paused    { background: #ff7d00; }
.goal-status-dot.completed { background: #86909c; }

.goal-content { flex: 1; min-width: 0; }
.goal-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.goal-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.goal-desc { font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.goal-actions { display: flex; gap: 2px; flex-shrink: 0; margin-left: 8px; }

/* ─── Sub units ──────────────────────────────────────────────────────── */

.sub-units-section { margin-bottom: 16px; }

.sub-units-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.sub-unit-card {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.sub-unit-card:hover {
  border-color: #165dff;
  box-shadow: 0 2px 8px rgba(22,93,255,0.1);
}

.suc-icon { font-size: 28px; margin-bottom: 8px; }
.suc-name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.suc-meta { display: flex; align-items: center; gap: 8px; }
.suc-count { font-size: 12px; color: var(--text-tertiary); }
.suc-goals { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; }

/* ─── Members ────────────────────────────────────────────────────────── */

.members-section { margin-top: 0; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.section-actions { display: flex; align-items: center; gap: 8px; }

.worker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 12px;
}

.worker-card {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 16px 14px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  position: relative;
}
.worker-card:hover { border-color: var(--border-color); box-shadow: var(--shadow-sm); }
.worker-card.selected { border-color: #165dff; background: rgba(22,93,255,0.04); }
.worker-card.leader { border-color: rgba(250,173,20,0.5); background: rgba(250,173,20,0.04); }

.wc-leader-crown { position: absolute; top: 8px; right: 10px; font-size: 14px; }
.wc-avatar { font-size: 36px; margin-bottom: 8px; }
.wc-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.wc-role { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }
.wc-status {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.wc-model { font-size: 10px; color: var(--text-tertiary); margin-top: 3px; font-family: monospace; }

.members-empty {
  grid-column: 1/-1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

/* Status dot */
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot.online  { background: #00b42a; }
.status-dot.idle    { background: #ff7d00; }
.status-dot.offline { background: #86909c; }

/* ─── Worker Drawer ──────────────────────────────────────────────────── */

.worker-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
}

.wd-avatar { font-size: 56px; margin-bottom: 8px; }
.worker-detail h2 { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.wd-role { color: var(--text-secondary); font-size: 13px; text-align: center; max-width: 240px; }

.wd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  width: 100%;
  padding: 3px 0;
}

.wd-assign-section { width: 100%; }
.wd-assign-label { font-size: 12px; color: var(--text-tertiary); margin-bottom: 6px; }
</style>
