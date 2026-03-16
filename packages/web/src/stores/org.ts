/**
 * Org Store — 任意深度的组织树
 *
 * 数据结构：OrgNode 递归树（localStorage 持久化，key: bcc_org_v2）
 * Worker 列表来自 workersStore（真实 API），组织结构本地维护。
 *
 * 节点类型可以是预设（root/branch/department/group/team）或用户自定义字符串。
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

export interface OrgNode {
  id: string;
  name: string;
  description: string;
  /** 节点类型：root | branch | department | group | team | 任意自定义字符串 */
  type: string;
  goals: OrgGoal[];
  children: OrgNode[];
  /** 直接隶属于此节点的 Worker IDs */
  memberIds: string[];
  /** 负责人 Worker ID（可选） */
  leaderId?: string;
}

const STORAGE_KEY = 'bcc_org_v2';

const DEFAULT_ROOT: OrgNode = {
  id: 'root',
  name: '我的组织',
  description: '基于 BCC 的 AI 工作团队',
  type: 'root',
  goals: [],
  children: [],
  memberIds: [],
};

function load(): OrgNode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as OrgNode;
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_ROOT);
}

function persist(root: OrgNode) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(root)); } catch { /* ignore */ }
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

export function findNode(id: string, node: OrgNode): OrgNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const found = findNode(id, c);
    if (found) return found;
  }
  return null;
}

function findParent(id: string, node: OrgNode, parent: OrgNode | null = null): OrgNode | null {
  if (node.id === id) return parent;
  for (const c of node.children) {
    const found = findParent(id, c, node);
    if (found !== null) return found;
  }
  return null;
}

/** 从 root 到目标节点的完整路径 */
export function getPath(id: string, node: OrgNode, path: OrgNode[] = []): OrgNode[] | null {
  path.push(node);
  if (node.id === id) return path;
  for (const c of node.children) {
    const found = getPath(id, c, [...path]);
    if (found) return found;
  }
  return null;
}

/** 递归统计节点下所有成员数（含子节点） */
export function totalMembers(node: OrgNode): number {
  return node.memberIds.length + node.children.reduce((s, c) => s + totalMembers(c), 0);
}

export const useOrgStore = defineStore('org', () => {
  const root = ref<OrgNode>(load());

  watch(root, () => persist(root.value), { deep: true });

  // ── Node lookup ─────────────────────────────────────────────────────────────

  function node(id: string): OrgNode | null {
    return findNode(id, root.value);
  }

  function path(id: string): OrgNode[] {
    return getPath(id, root.value) ?? [root.value];
  }

  // ── Node CRUD ───────────────────────────────────────────────────────────────

  function updateNode(id: string, patch: Partial<Pick<OrgNode, 'name' | 'description' | 'type' | 'leaderId'>>) {
    const n = findNode(id, root.value);
    if (n) Object.assign(n, patch);
  }

  /** 在 parentId 下新建子节点，parentId=null 则添加到 root.children */
  function addChild(parentId: string | null, data: Pick<OrgNode, 'name' | 'description' | 'type'>): OrgNode {
    const newNode: OrgNode = {
      id: `node-${Date.now()}`,
      goals: [],
      children: [],
      memberIds: [],
      ...data,
    };
    const parent = parentId ? findNode(parentId, root.value) : root.value;
    if (parent) parent.children.push(newNode);
    return newNode;
  }

  function deleteNode(id: string) {
    if (id === 'root') return;
    const parent = findParent(id, root.value);
    if (parent) {
      parent.children = parent.children.filter(c => c.id !== id);
    }
  }

  // ── Worker assignment ───────────────────────────────────────────────────────

  function getWorkerNodeId(workerId: string): string | null {
    function dfs(n: OrgNode): string | null {
      if (n.memberIds.includes(workerId)) return n.id;
      for (const c of n.children) {
        const found = dfs(c);
        if (found) return found;
      }
      return null;
    }
    return dfs(root.value);
  }

  function assignWorker(workerId: string, nodeId: string | null) {
    // Remove from wherever it currently is
    function remove(n: OrgNode) {
      n.memberIds = n.memberIds.filter(id => id !== workerId);
      n.children.forEach(remove);
      if (n.leaderId === workerId && nodeId !== n.id) n.leaderId = undefined;
    }
    remove(root.value);

    if (nodeId) {
      const target = findNode(nodeId, root.value);
      if (target && !target.memberIds.includes(workerId)) target.memberIds.push(workerId);
    }
  }

  function setLeader(nodeId: string, workerId: string | null) {
    const n = findNode(nodeId, root.value);
    if (n) n.leaderId = workerId ?? undefined;
  }

  // ── Goals ───────────────────────────────────────────────────────────────────

  function addGoal(nodeId: string, data: Omit<OrgGoal, 'id'>): OrgGoal {
    const n = findNode(nodeId, root.value);
    if (!n) return { id: '', ...data };
    const goal: OrgGoal = { ...data, id: `goal-${Date.now()}` };
    n.goals.push(goal);
    return goal;
  }

  function updateGoal(nodeId: string, goalId: string, patch: Partial<Omit<OrgGoal, 'id'>>) {
    const n = findNode(nodeId, root.value);
    const g = n?.goals.find(g => g.id === goalId);
    if (g) Object.assign(g, patch);
  }

  function deleteGoal(nodeId: string, goalId: string) {
    const n = findNode(nodeId, root.value);
    if (n) n.goals = n.goals.filter(g => g.id !== goalId);
  }

  // ── Collect all nodes flat (for analytics dept mapping) ─────────────────────

  function allNodes(): OrgNode[] {
    const result: OrgNode[] = [];
    function dfs(n: OrgNode) { result.push(n); n.children.forEach(dfs); }
    dfs(root.value);
    return result;
  }

  return {
    root,
    node, path,
    updateNode, addChild, deleteNode,
    getWorkerNodeId, assignWorker, setLeader,
    addGoal, updateGoal, deleteGoal,
    allNodes,
  };
});

// ── Node type metadata ────────────────────────────────────────────────────────

export const NODE_TYPE_OPTIONS = [
  { value: 'root',       label: '总公司',   icon: '🏢' },
  { value: 'branch',     label: '分公司',   icon: '🏬' },
  { value: 'department', label: '部门',     icon: '🏛️' },
  { value: 'group',      label: '组',       icon: '👥' },
  { value: 'team',       label: '团队',     icon: '🎯' },
  { value: 'custom',     label: '自定义',   icon: '📁' },
];

export function nodeTypeIcon(type: string): string {
  return NODE_TYPE_OPTIONS.find(o => o.value === type)?.icon ?? '📁';
}

export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_OPTIONS.find(o => o.value === type)?.label ?? type;
}
