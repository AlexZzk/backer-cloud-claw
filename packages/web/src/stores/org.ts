/**
 * Org Store — 管理组织架构（公司/部门/Worker-部门映射/目标）
 *
 * 数据持久化到 localStorage（key: bcc_org）。
 * Worker 列表来自 workersStore（真实 API），部门结构本地维护。
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface OrgGoal {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'completed' | 'paused';
}

export interface OrgDepartment {
  id: string;
  name: string;
  description: string;
  goals: OrgGoal[];
  /** Worker IDs 分配到该部门 */
  memberIds: string[];
}

export interface OrgCompany {
  name: string;
  description: string;
  goals: OrgGoal[];
}

interface OrgState {
  company: OrgCompany;
  departments: OrgDepartment[];
}

const STORAGE_KEY = 'bcc_org';

const DEFAULT_STATE: OrgState = {
  company: {
    name: '我的组织',
    description: '基于 BCC 的 AI 工作团队',
    goals: [],
  },
  departments: [],
};

function load(): OrgState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as OrgState;
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_STATE);
}

function save(state: OrgState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export const useOrgStore = defineStore('org', () => {
  const loaded = load();
  const company = ref<OrgCompany>(loaded.company);
  const departments = ref<OrgDepartment[]>(loaded.departments);

  // Auto-persist on change
  watch([company, departments], () => {
    save({ company: company.value, departments: departments.value });
  }, { deep: true });

  // ── Company ───────────────────────────────────────────────────────────────

  function updateCompany(patch: Partial<OrgCompany>) {
    Object.assign(company.value, patch);
  }

  // ── Departments ───────────────────────────────────────────────────────────

  function createDepartment(name: string, description: string): OrgDepartment {
    const dept: OrgDepartment = {
      id: `dept-${Date.now()}`,
      name, description,
      goals: [],
      memberIds: [],
    };
    departments.value.push(dept);
    return dept;
  }

  function updateDepartment(id: string, patch: Partial<Pick<OrgDepartment, 'name' | 'description'>>) {
    const dept = departments.value.find(d => d.id === id);
    if (dept) Object.assign(dept, patch);
  }

  function deleteDepartment(id: string) {
    const idx = departments.value.findIndex(d => d.id === id);
    if (idx !== -1) departments.value.splice(idx, 1);
  }

  // ── Member assignments ────────────────────────────────────────────────────

  /** 将 workerId 分配到指定部门（自动从其他部门移除） */
  function assignWorker(workerId: string, deptId: string | null) {
    // Remove from all depts first
    for (const d of departments.value) {
      d.memberIds = d.memberIds.filter(id => id !== workerId);
    }
    if (deptId) {
      const dept = departments.value.find(d => d.id === deptId);
      if (dept && !dept.memberIds.includes(workerId)) dept.memberIds.push(workerId);
    }
  }

  /** 找到 workerId 所属的部门 ID，没有则返回 null */
  function getWorkerDept(workerId: string): string | null {
    return departments.value.find(d => d.memberIds.includes(workerId))?.id ?? null;
  }

  // ── Goals ─────────────────────────────────────────────────────────────────

  function addGoal(targetId: 'company' | string, goal: Omit<OrgGoal, 'id'>): OrgGoal {
    const newGoal: OrgGoal = { ...goal, id: `goal-${Date.now()}` };
    if (targetId === 'company') {
      company.value.goals.push(newGoal);
    } else {
      const dept = departments.value.find(d => d.id === targetId);
      if (dept) dept.goals.push(newGoal);
    }
    return newGoal;
  }

  function updateGoal(targetId: 'company' | string, goalId: string, patch: Partial<Omit<OrgGoal, 'id'>>) {
    const goals = targetId === 'company'
      ? company.value.goals
      : departments.value.find(d => d.id === targetId)?.goals ?? [];
    const goal = goals.find(g => g.id === goalId);
    if (goal) Object.assign(goal, patch);
  }

  function deleteGoal(targetId: 'company' | string, goalId: string) {
    const goals = targetId === 'company'
      ? company.value.goals
      : departments.value.find(d => d.id === targetId)?.goals ?? [];
    const idx = goals.findIndex(g => g.id === goalId);
    if (idx !== -1) goals.splice(idx, 1);
  }

  return {
    company, departments,
    updateCompany,
    createDepartment, updateDepartment, deleteDepartment,
    assignWorker, getWorkerDept,
    addGoal, updateGoal, deleteGoal,
  };
});
