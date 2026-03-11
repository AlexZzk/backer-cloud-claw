import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { WorkerTask, TaskStatus, TaskPriority, OrgEvent } from '@bcc/foundation';
import { TaskStore } from './task-store.js';

export interface CreateTaskOptions {
  title: string;
  description: string;
  priority?: TaskPriority;
  createdBy: string;
  chatId?: string;
  messageId?: string;
  dueAt?: number;
  parentTaskId?: string;
}

export interface TaskSummary {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  blocked: number;
  cancelled: number;
  nextTask: WorkerTask | null;
}

export interface TaskManagerOptions {
  store: TaskStore;
  workerId: string;
  /** 共享的事件总线（通常来自 Company） */
  eventBus?: EventEmitter;
}

/**
 * TaskManager：Worker 的任务管理器（TodoList）。
 *
 * 每个 Worker 拥有独立的 TaskManager 实例，负责：
 * - 创建、更新、查询本 Worker 的任务列表
 * - 按优先级获取下一个待处理任务
 * - 定期审视任务状态，提供摘要报告
 *
 * 任务来源：
 * 1. 用户通过聊天消息指派
 * 2. 其他 Worker 通过消息委托
 * 3. Worker 自主拆解复杂任务为子任务
 */
export class TaskManager {
  private store: TaskStore;
  private workerId: string;
  private eventBus: EventEmitter;

  constructor(options: TaskManagerOptions) {
    this.store = options.store;
    this.workerId = options.workerId;
    this.eventBus = options.eventBus ?? new EventEmitter();
  }

  /**
   * 创建一个新任务并加入待办列表。
   */
  async create(options: CreateTaskOptions): Promise<WorkerTask> {
    const now = Date.now();
    const task: WorkerTask = {
      id: randomUUID(),
      assignedTo: this.workerId,
      createdBy: options.createdBy,
      title: options.title,
      description: options.description,
      status: 'todo',
      priority: options.priority ?? 'medium',
      createdAt: now,
      updatedAt: now,
      ...(options.chatId ? { chatId: options.chatId } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      ...(options.dueAt ? { dueAt: options.dueAt } : {}),
      ...(options.parentTaskId ? { parentTaskId: options.parentTaskId } : {}),
    };

    await this.store.save(task);

    this.eventBus.emit('org:event', {
      type: 'task:created',
      task,
    } satisfies OrgEvent);

    return task;
  }

  /** 根据 ID 获取任务 */
  async get(taskId: string): Promise<WorkerTask | null> {
    return this.store.get(this.workerId, taskId);
  }

  /**
   * 列出任务，可按状态过滤。
   * 默认按优先级倒序 + 创建时间升序。
   */
  async list(statusFilter?: TaskStatus[]): Promise<WorkerTask[]> {
    return this.store.list(this.workerId, statusFilter);
  }

  /**
   * 更新任务状态。
   */
  async updateStatus(taskId: string, status: TaskStatus): Promise<WorkerTask | null> {
    const task = await this.get(taskId);
    if (!task) return null;

    const previousStatus = task.status;
    const updated: WorkerTask = { ...task, status, updatedAt: Date.now() };
    await this.store.save(updated);

    this.eventBus.emit('org:event', {
      type: 'task:updated',
      task: updated,
      previousStatus,
    } satisfies OrgEvent);

    if (status === 'done') {
      this.eventBus.emit('org:event', {
        type: 'task:completed',
        task: updated,
      } satisfies OrgEvent);
    }

    return updated;
  }

  /** 更新任务优先级 */
  async updatePriority(taskId: string, priority: TaskPriority): Promise<WorkerTask | null> {
    const task = await this.get(taskId);
    if (!task) return null;

    const updated: WorkerTask = { ...task, priority, updatedAt: Date.now() };
    await this.store.save(updated);
    return updated;
  }

  /** 更新任务描述 */
  async update(taskId: string, patch: Partial<Pick<WorkerTask, 'title' | 'description' | 'dueAt'>>): Promise<WorkerTask | null> {
    const task = await this.get(taskId);
    if (!task) return null;

    const updated: WorkerTask = { ...task, ...patch, updatedAt: Date.now() };
    await this.store.save(updated);
    return updated;
  }

  /** 删除任务 */
  async delete(taskId: string): Promise<void> {
    await this.store.delete(this.workerId, taskId);
  }

  /**
   * 获取优先级最高的待处理任务（status = 'todo' 或 'in_progress'）。
   * Worker 的"工作审视周期"中调用此方法来决定下一步做什么。
   */
  async getNextTask(): Promise<WorkerTask | null> {
    const active = await this.list(['todo', 'in_progress']);
    return active[0] ?? null;
  }

  /**
   * 生成任务摘要报告。
   * Worker 定期审视自己的状态时调用，也可以注入 LLM context。
   */
  async getSummary(): Promise<TaskSummary> {
    const all = await this.list();
    const count = (status: TaskStatus) => all.filter(t => t.status === status).length;

    const active = all.filter(t => t.status === 'todo' || t.status === 'in_progress');
    const nextTask = active[0] ?? null;

    const summary: TaskSummary = {
      total: all.length,
      todo: count('todo'),
      inProgress: count('in_progress'),
      done: count('done'),
      blocked: count('blocked'),
      cancelled: count('cancelled'),
      nextTask,
    };

    this.eventBus.emit('org:event', {
      type: 'worker:tasks:reviewed',
      workerId: this.workerId,
      taskSummary: {
        todo: summary.todo,
        inProgress: summary.inProgress,
        done: summary.done,
      },
    } satisfies OrgEvent);

    return summary;
  }

  /**
   * 将任务摘要序列化为可注入 LLM 的文本（系统提示或上下文）。
   */
  async formatSummaryForPrompt(): Promise<string> {
    const summary = await this.getSummary();
    if (summary.total === 0) return '当前没有待处理任务。';

    const lines: string[] = [
      `任务概览（共 ${summary.total} 项）：`,
      `  - 待处理：${summary.todo} 项`,
      `  - 进行中：${summary.inProgress} 项`,
      `  - 已完成：${summary.done} 项`,
      `  - 阻塞中：${summary.blocked} 项`,
    ];

    if (summary.nextTask) {
      lines.push('');
      lines.push(`当前最高优先级任务：`);
      lines.push(`  [${summary.nextTask.priority.toUpperCase()}] ${summary.nextTask.title}`);
      lines.push(`  ${summary.nextTask.description}`);
    }

    const active = await this.list(['todo', 'in_progress']);
    if (active.length > 1) {
      lines.push('');
      lines.push('全部待处理任务：');
      for (const t of active) {
        lines.push(`  - [${t.priority}] ${t.title} (${t.status})`);
      }
    }

    return lines.join('\n');
  }
}
