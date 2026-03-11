import { EventEmitter } from 'node:events';
import type { OrgEvent } from '@bcc/foundation';

/**
 * ReviewContext：Worker 定期审视时传入的上下文信息，
 * 由调用方（Company 或上层应用）提供该 Worker 的 inbox 检查逻辑。
 */
export interface ReviewContext {
  /** Worker ID */
  workerId: string;
  /** 审视逻辑：检查 inbox + 处理任务。由外部注入实现（解耦） */
  onReview: () => Promise<void>;
}

export interface SchedulerOptions {
  /** 默认审视间隔（毫秒），默认 60 秒 */
  defaultIntervalMs?: number;
  /** 共享事件总线 */
  eventBus?: EventEmitter;
}

/**
 * WorkerScheduler：Worker 定期审视调度器。
 *
 * 设计思路（类比真实公司员工的工作方式）：
 * - 每个员工（Worker）不是 24 小时待命等待指令
 * - 而是按照自己的节奏，定期查看消息、审视任务、处理待办事项
 * - 这种模式更符合异步协作的本质，也避免了同步阻塞
 *
 * 工作流程：
 * 1. 注册 Worker 的审视回调（`register`）
 * 2. 启动调度（`start`），按间隔定时触发
 * 3. 也可手动触发单次审视（`triggerReview`）
 * 4. 停止调度（`stop`）
 */
export class WorkerScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private contexts = new Map<string, ReviewContext>();
  private defaultIntervalMs: number;
  private eventBus: EventEmitter;

  constructor(options: SchedulerOptions = {}) {
    this.defaultIntervalMs = options.defaultIntervalMs ?? 60_000;
    this.eventBus = options.eventBus ?? new EventEmitter();
  }

  /**
   * 注册一个 Worker 的审视上下文。
   * 注册后才能通过 start() 或 triggerReview() 驱动。
   */
  register(context: ReviewContext): void {
    this.contexts.set(context.workerId, context);
  }

  /** 注销一个 Worker */
  unregister(workerId: string): void {
    this.stop(workerId);
    this.contexts.delete(workerId);
  }

  /**
   * 启动某个 Worker 的定时审视。
   * 如果已在运行，先停止旧定时器再启动新的。
   */
  start(workerId: string, intervalMs?: number): void {
    this.stop(workerId);

    const context = this.contexts.get(workerId);
    if (!context) {
      throw new Error(`Worker ${workerId} 未注册到 WorkerScheduler`);
    }

    const interval = intervalMs ?? this.defaultIntervalMs;
    const timer = setInterval(async () => {
      await this._runReview(context);
    }, interval);

    // Node.js：允许进程在只剩定时器时退出
    if (timer.unref) timer.unref();

    this.timers.set(workerId, timer);
  }

  /** 启动所有已注册 Worker 的定时审视 */
  startAll(intervalMs?: number): void {
    for (const workerId of this.contexts.keys()) {
      this.start(workerId, intervalMs);
    }
  }

  /** 停止某个 Worker 的定时审视 */
  stop(workerId: string): void {
    const timer = this.timers.get(workerId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(workerId);
    }
  }

  /** 停止所有定时审视 */
  stopAll(): void {
    for (const workerId of this.timers.keys()) {
      this.stop(workerId);
    }
  }

  /**
   * 立即触发某个 Worker 的单次审视（不受间隔限制）。
   * 可用于：外部事件（新消息到达）触发的按需审视。
   */
  async triggerReview(workerId: string): Promise<void> {
    const context = this.contexts.get(workerId);
    if (!context) {
      throw new Error(`Worker ${workerId} 未注册到 WorkerScheduler`);
    }
    await this._runReview(context);
  }

  /** 触发所有 Worker 的单次审视 */
  async triggerAll(): Promise<void> {
    const reviews = [...this.contexts.values()].map(ctx => this._runReview(ctx));
    await Promise.allSettled(reviews);
  }

  /** 获取当前已注册的 Worker ID 列表 */
  listWorkers(): string[] {
    return [...this.contexts.keys()];
  }

  /** 检查某个 Worker 是否正在运行定时审视 */
  isRunning(workerId: string): boolean {
    return this.timers.has(workerId);
  }

  // ─── 私有 ────────────────────────────────────────────────────────────────────

  private async _runReview(context: ReviewContext): Promise<void> {
    try {
      await context.onReview();
    } catch (err) {
      // 审视异常不能让调度器崩溃，记录事件后继续
      this.eventBus.emit('org:event', {
        type: 'worker:inbox:checked',
        workerId: context.workerId,
        pendingCount: -1, // -1 表示审视出错
      } satisfies OrgEvent);
    }
  }
}
