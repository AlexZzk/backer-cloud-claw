import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { WorkerTask, TaskStatus } from '@bcc/foundation';

export interface TaskStoreOptions {
  /**
   * 任务数据存储目录。
   *
   * 默认：~/.bcc/tasks
   * 每个 Worker 的任务存储为独立 JSON 文件：{dir}/{workerId}-tasks.json
   */
  dir?: string | undefined;
}

interface TaskFile {
  workerId: string;
  updatedAt: string;
  tasks: WorkerTask[];
}

const DEFAULT_DIR = join(homedir(), '.bcc', 'tasks');

/**
 * TaskStore：基于文件系统的 Worker 任务存储。
 *
 * 每个 Worker 的所有任务存储在同一个 JSON 文件中：
 *   {dir}/{workerId}-tasks.json
 *
 * 设计原则：
 * - 零外部依赖
 * - 文件损坏时返回空列表而非抛出异常
 * - 写操作原子性：先构建完整内容再写入文件
 */
export class TaskStore {
  private dir: string;
  private initialized = false;

  constructor(options: TaskStoreOptions = {}) {
    this.dir = resolve(options.dir ?? DEFAULT_DIR);
  }

  /** 保存（创建或更新）一个任务 */
  async save(task: WorkerTask): Promise<void> {
    const tasks = await this._loadAll(task.assignedTo);
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.push(task);
    }
    await this._saveAll(task.assignedTo, tasks);
  }

  /** 根据 ID 获取任务（跨 Worker 搜索，适用于子任务场景） */
  async get(workerId: string, taskId: string): Promise<WorkerTask | null> {
    const tasks = await this._loadAll(workerId);
    return tasks.find(t => t.id === taskId) ?? null;
  }

  /**
   * 列出某 Worker 的所有任务，可按状态过滤。
   * 默认按优先级倒序 + 创建时间升序排列。
   */
  async list(workerId: string, statusFilter?: TaskStatus[]): Promise<WorkerTask[]> {
    const tasks = await this._loadAll(workerId);
    const filtered = statusFilter
      ? tasks.filter(t => statusFilter.includes(t.status))
      : tasks;

    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return filtered.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pd !== 0) return pd;
      return a.createdAt - b.createdAt;
    });
  }

  /** 删除一个任务 */
  async delete(workerId: string, taskId: string): Promise<void> {
    const tasks = await this._loadAll(workerId);
    const filtered = tasks.filter(t => t.id !== taskId);
    await this._saveAll(workerId, filtered);
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private async _loadAll(workerId: string): Promise<WorkerTask[]> {
    const path = this._pathFor(workerId);
    if (!(await this._exists(path))) return [];
    try {
      const raw = await readFile(path, 'utf-8');
      const file = JSON.parse(raw) as TaskFile;
      return file.tasks;
    } catch {
      return [];
    }
  }

  private async _saveAll(workerId: string, tasks: WorkerTask[]): Promise<void> {
    await this.ensureDir();
    const path = this._pathFor(workerId);
    const payload: TaskFile = {
      workerId,
      updatedAt: new Date().toISOString(),
      tasks,
    };
    await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private _pathFor(workerId: string): string {
    const safe = workerId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return join(this.dir, `${safe}-tasks.json`);
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    this.initialized = true;
  }

  private async _exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
