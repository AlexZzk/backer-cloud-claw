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

      <div class="company-info">
        <div class="company-logo">🏢</div>
        <div>
          <div class="company-name">{{ company.name }}</div>
          <div class="company-desc">{{ company.description }}</div>
        </div>
      </div>

      <a-divider style="margin: 8px 0" />

      <div class="dept-list">
        <div
          v-for="dept in company.departments"
          :key="dept.id"
          class="dept-item"
          :class="{ active: selectedDeptId === dept.id }"
          @click="selectedDeptId = dept.id; selectedEmployeeId = null"
        >
          <icon-team class="dept-icon" />
          <div class="dept-info">
            <div class="dept-name">{{ dept.name }}</div>
            <div class="dept-count">{{ dept.members.length }} {{ t('org.members') }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="org-main">
      <!-- View toggle -->
      <div class="view-header">
        <div>
          <h2 v-if="selectedDept">{{ selectedDept.name }}</h2>
          <h2 v-else>{{ company.name }}</h2>
          <p class="view-desc" v-if="selectedDept">{{ selectedDept.description }}</p>
          <p class="view-desc" v-else>{{ company.description }}</p>
        </div>
        <div class="view-actions">
          <a-radio-group v-model="viewMode" type="button" size="small">
            <a-radio value="grid"><icon-apps /></a-radio>
            <a-radio value="list"><icon-list /></a-radio>
          </a-radio-group>
          <a-button @click="showAddEmployee = true">
            <template #icon><icon-plus /></template>
            {{ t('org.addEmployee') }}
          </a-button>
        </div>
      </div>

      <!-- Employee grid -->
      <div v-if="viewMode === 'grid'" class="employee-grid">
        <div
          v-for="emp in displayEmployees"
          :key="emp.id"
          class="employee-card"
          :class="{ selected: selectedEmployeeId === emp.id }"
          @click="selectedEmployeeId = emp.id === selectedEmployeeId ? null : emp.id"
        >
          <div class="emp-avatar">{{ emp.avatar }}</div>
          <div class="emp-name">{{ emp.name }}</div>
          <div class="emp-role">{{ emp.role }}</div>
          <div class="emp-email">{{ emp.email }}</div>
          <div class="emp-dept-tag">
            <a-tag size="small" color="arcoblue">
              {{ getDeptName(emp.departmentId) }}
            </a-tag>
          </div>
          <div v-if="emp.workerId" class="emp-worker-badge">
            <a-tag size="small" color="green">
              🤖 {{ getWorkerName(emp.workerId) }}
            </a-tag>
          </div>
        </div>
      </div>

      <!-- Employee list -->
      <a-table
        v-else
        :data="displayEmployees"
        :bordered="false"
        :stripe="true"
        row-key="id"
        :pagination="{ pageSize: 10, simple: true }"
        style="margin-top: 8px;"
      >
        <template #columns>
          <a-table-column title="" data-index="avatar" :width="50">
            <template #cell="{ record }">
              <span style="font-size: 22px;">{{ record.avatar }}</span>
            </template>
          </a-table-column>
          <a-table-column :title="t('org.employeeName')" data-index="name" />
          <a-table-column :title="t('org.employeeRole')" data-index="role" />
          <a-table-column :title="t('org.employeeEmail')" data-index="email" />
          <a-table-column :title="t('org.department')">
            <template #cell="{ record }">
              <a-tag size="small" color="arcoblue">{{ getDeptName(record.departmentId) }}</a-tag>
            </template>
          </a-table-column>
          <a-table-column title="Worker">
            <template #cell="{ record }">
              <a-tag v-if="record.workerId" size="small" color="green">
                🤖 {{ getWorkerName(record.workerId) }}
              </a-tag>
              <span v-else class="no-worker">—</span>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <!-- Org chart overview (when no dept selected) -->
      <div v-if="!selectedDeptId" class="org-overview">
        <h3 style="margin-bottom: 16px;">{{ t('org.orgChart') }}</h3>
        <div class="org-chart">
          <div class="oc-company">
            <div class="oc-node company-node">
              <span>🏢</span>
              <strong>{{ company.name }}</strong>
            </div>
            <div class="oc-children">
              <div v-for="dept in company.departments" :key="dept.id" class="oc-dept">
                <div class="oc-connector"></div>
                <div class="oc-node dept-node" @click="openDeptDrawer(dept.id)">
                  <icon-team />
                  <span>{{ dept.name }}</span>
                  <small>{{ dept.members.length }}人</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Employee detail drawer -->
    <a-drawer
      v-if="selectedEmployee"
      :visible="!!selectedEmployeeId"
      :title="selectedEmployee.name"
      :width="320"
      @cancel="selectedEmployeeId = null"
      :footer="false"
    >
      <div class="emp-detail">
        <div class="empd-avatar">{{ selectedEmployee.avatar }}</div>
        <h2>{{ selectedEmployee.name }}</h2>
        <p class="empd-role">{{ selectedEmployee.role }}</p>
        <a-divider />
        <div class="empd-row">
          <icon-email />
          <span>{{ selectedEmployee.email }}</span>
        </div>
        <div class="empd-row">
          <icon-team />
          <span>{{ getDeptName(selectedEmployee.departmentId) }}</span>
        </div>
        <div v-if="selectedEmployee.workerId" class="empd-row">
          <span>🤖</span>
          <a-tag color="green">{{ getWorkerName(selectedEmployee.workerId) }}</a-tag>
        </div>
      </div>
    </a-drawer>

    <!-- Department detail drawer (triggered by org chart click) -->
    <a-drawer
      v-if="drawerDept"
      :visible="showDeptDrawer"
      :title="drawerDept.name"
      :width="360"
      @cancel="showDeptDrawer = false"
      :footer="false"
    >
      <div class="dept-detail">
        <p class="dept-detail-desc">{{ drawerDept.description }}</p>
        <a-divider />
        <h4 style="margin-bottom: 12px;">{{ t('org.members') }}（{{ drawerDept.members.length }}）</h4>
        <div class="dept-member-list">
          <div
            v-for="emp in drawerDept.members"
            :key="emp.id"
            class="dept-member-item"
          >
            <span class="dm-avatar">{{ emp.avatar }}</span>
            <div class="dm-info">
              <div class="dm-name">{{ emp.name }}</div>
              <div class="dm-role">{{ emp.role }}</div>
            </div>
            <a-tag v-if="emp.workerId" color="green" size="small">
              🤖 {{ getWorkerName(emp.workerId) }}
            </a-tag>
          </div>
        </div>
        <a-divider />
        <a-button
          type="primary"
          long
          @click="selectedDeptId = drawerDept!.id; showDeptDrawer = false"
        >
          查看完整部门详情
        </a-button>
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
          <a-input v-model="newDept.name" />
        </a-form-item>
        <a-form-item :label="t('common.description')">
          <a-input v-model="newDept.description" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Add employee modal -->
    <a-modal
      v-model:visible="showAddEmployee"
      :title="t('org.addEmployee')"
      @ok="handleAddEmployee"
      @cancel="showAddEmployee = false"
    >
      <a-form layout="vertical">
        <a-form-item :label="t('org.employeeName')">
          <a-input v-model="newEmp.name" />
        </a-form-item>
        <a-form-item :label="t('org.employeeRole')">
          <a-input v-model="newEmp.role" />
        </a-form-item>
        <a-form-item :label="t('org.employeeEmail')">
          <a-input v-model="newEmp.email" />
        </a-form-item>
        <a-form-item :label="t('org.department')">
          <a-select v-model="newEmp.departmentId">
            <a-option v-for="d in company.departments" :key="d.id" :value="d.id">{{ d.name }}</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="Worker (可选)">
          <a-select v-model="newEmp.workerId" allow-clear :placeholder="t('common.noData')">
            <a-option v-for="w in workersStore.workers" :key="w.id" :value="w.id">
              {{ w.avatar }} {{ w.name }}
            </a-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorkersStore } from '@/stores/workers';
import { MOCK_COMPANY, type MockEmployee } from '@/mock/data';
import { Message } from '@arco-design/web-vue';

const { t } = useI18n();
const workersStore = useWorkersStore();

const company = reactive({ ...MOCK_COMPANY });
const selectedDeptId = ref<string | null>(null);
const selectedEmployeeId = ref<string | null>(null);
const viewMode = ref<'grid' | 'list'>('grid');
const showCreateDept = ref(false);
const showAddEmployee = ref(false);

// Org chart department drawer
const showDeptDrawer = ref(false);
const drawerDeptId = ref<string | null>(null);
const drawerDept = computed(() =>
  drawerDeptId.value ? company.departments.find(d => d.id === drawerDeptId.value) ?? null : null
);

function openDeptDrawer(deptId: string) {
  drawerDeptId.value = deptId;
  showDeptDrawer.value = true;
}

const newDept = reactive({ name: '', description: '' });
const newEmp = reactive({ name: '', role: '', email: '', departmentId: '', workerId: '' });

const selectedDept = computed(() =>
  selectedDeptId.value ? company.departments.find(d => d.id === selectedDeptId.value) : null
);

const selectedEmployee = computed(() => {
  if (!selectedEmployeeId.value) return null;
  for (const dept of company.departments) {
    const emp = dept.members.find(e => e.id === selectedEmployeeId.value);
    if (emp) return emp;
  }
  return null;
});

const displayEmployees = computed(() => {
  if (selectedDept.value) return selectedDept.value.members;
  return company.departments.flatMap(d => d.members);
});

function getDeptName(deptId: string): string {
  return company.departments.find(d => d.id === deptId)?.name ?? deptId;
}

function getWorkerName(workerId: string): string {
  return workersStore.workers.find(w => w.id === workerId)?.name ?? workerId;
}

function handleCreateDept() {
  if (!newDept.name) return;
  company.departments.push({
    id: `dept-${Date.now()}`,
    name: newDept.name,
    description: newDept.description,
    members: [],
  });
  Object.assign(newDept, { name: '', description: '' });
  showCreateDept.value = false;
  Message.success(t('common.success'));
}

function handleAddEmployee() {
  if (!newEmp.name || !newEmp.departmentId) return;
  const dept = company.departments.find(d => d.id === newEmp.departmentId);
  if (!dept) return;
  const emp: MockEmployee = {
    id: `emp-${Date.now()}`,
    name: newEmp.name,
    role: newEmp.role,
    email: newEmp.email,
    avatar: '👤',
    departmentId: newEmp.departmentId,
    workerId: newEmp.workerId || undefined,
  };
  dept.members.push(emp);
  Object.assign(newEmp, { name: '', role: '', email: '', departmentId: '', workerId: '' });
  showAddEmployee.value = false;
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
}

.company-logo {
  font-size: 32px;
  flex-shrink: 0;
}

.company-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.company-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

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
}

.dept-item:hover { background: rgba(22, 93, 255, 0.05); color: var(--text-primary); }
.dept-item.active { background: rgba(22, 93, 255, 0.1); color: #165dff; }

.dept-icon { font-size: 18px; flex-shrink: 0; }

.dept-info { min-width: 0; }

.dept-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dept-count {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* ─── Main ───────────────────────────────────────────────────────────── */

.org-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg-card);
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.view-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.view-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.view-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ─── Employee Grid ──────────────────────────────────────────────────── */

.employee-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}

.employee-card {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.employee-card:hover {
  border-color: var(--border-color);
  box-shadow: var(--shadow-sm);
}

.employee-card.selected {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.04);
}

.emp-avatar { font-size: 40px; margin-bottom: 10px; }
.emp-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.emp-role { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.emp-email { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.emp-dept-tag { margin-top: 8px; }
.emp-worker-badge { margin-top: 6px; }

/* ─── Org Chart ──────────────────────────────────────────────────────── */

.org-overview {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

.org-chart {
  overflow-x: auto;
  padding: 20px 0;
}

.oc-company {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.oc-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 14px;
  border: 2px solid var(--border-color);
  background: var(--bg-base);
  text-align: center;
  font-size: 13px;
  min-width: 120px;
}

.oc-node.company-node {
  background: linear-gradient(135deg, rgba(22, 93, 255, 0.1), rgba(114, 46, 209, 0.1));
  border-color: #165dff;
  font-size: 15px;
  padding: 20px 28px;
}

.oc-node.company-node span { font-size: 28px; }

.oc-node.dept-node {
  cursor: pointer;
  transition: all 0.15s;
}

.oc-node.dept-node:hover {
  border-color: #165dff;
  box-shadow: var(--shadow-sm);
}

.oc-node small {
  font-size: 11px;
  color: var(--text-tertiary);
}

.oc-children {
  display: flex;
  gap: 20px;
  position: relative;
  padding-top: 0;
}

.oc-children::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 80px);
  height: 2px;
  background: var(--border-color);
}

.oc-dept {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.oc-connector {
  width: 2px;
  height: 24px;
  background: var(--border-color);
}

/* ─── Employee Detail ────────────────────────────────────────────────── */

.emp-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
}

.empd-avatar {
  font-size: 60px;
  margin-bottom: 8px;
}

.emp-detail h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.empd-role {
  color: var(--text-secondary);
  font-size: 14px;
}

.empd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-secondary);
  width: 100%;
  padding: 6px 0;
}

.no-worker {
  color: var(--text-tertiary);
}

/* ─── Department Drawer ──────────────────────────────────────────────── */

.dept-detail {
  padding: 4px 0;
}

.dept-detail-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.dept-member-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dept-member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-base);
  border-radius: 10px;
  border: 1px solid var(--border-color);
}

.dm-avatar { font-size: 24px; flex-shrink: 0; }

.dm-info { flex: 1; min-width: 0; }

.dm-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.dm-role {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
</style>
