import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { OrgEvent, OrgMessage, OrgThread, Participant, WorkerProfile } from '@bcc/foundation';
import { MessageRouter } from './router.js';
import { ThreadManager } from './thread.js';
import { TokenTracker } from './token-tracker.js';
import type { WorkerTokenSummary } from './token-tracker.js';
import type { Worker } from './worker.js';
import { WorkerScheduler } from './worker-scheduler.js';

export interface CompanyOptions {
  /** 公司名称，例如"研发团队" */
  name: string;
  /** 公司的职责描述（当 Company 本身作为 Participant 被调用时使用） */
  description?: string;
}

/**
 * Company：Worker 的集合，实现 Composite 模式。
 *
 * Company 本身也是一个 Participant，可以作为更大 Company 的成员（嵌套组织）。
 * 对外表现为一个整体：发给 Company 的消息会被路由给合适的内部 Worker。
 *
 * 核心职责：
 * - 管理成员（addWorker / removeWorker）
 * - 管理 Thread（openThread / closeThread）
 * - 汇聚 Token 消耗数据（供管理后台查询）
 * - 事件总线（所有成员 Worker 共享，事件冒泡到 Company 层）
 */
export class Company implements Participant {
  readonly id: string;
  readonly profile: WorkerProfile;

  readonly eventBus: EventEmitter;
  readonly tokenTracker: TokenTracker;
  readonly scheduler: WorkerScheduler;

  private router: MessageRouter;
  private threadManager: ThreadManager;
  private members = new Map<string, Participant>();

  constructor(options: CompanyOptions) {
    this.id = randomUUID();
    this.eventBus = new EventEmitter();
    this.tokenTracker = new TokenTracker();
    this.router = new MessageRouter();
    this.threadManager = new ThreadManager(this.eventBus);
    this.scheduler = new WorkerScheduler({ eventBus: this.eventBus });

    // Company 自身的 profile（当它作为 Participant 被调用时用）
    this.profile = {
      id: this.id,
      name: options.name,
      role: 'company',
      skills: [],
      description: options.description ?? `${options.name} 公司，包含多名 AI 员工`,
      modelId: '',
    };
  }

  // ─── 成员管理 ────────────────────────────────────────────────────────────────

  /**
   * 加入一名 Worker（Worker 将共享本 Company 的 tokenTracker 和 eventBus）。
   *
   * 若 Worker 注入了 AsyncInboxService，会自动将其注册到 WorkerScheduler，
   * 调用 company.scheduler.start(workerId) 即可启动定期审视。
   */
  addWorker(worker: Worker): void {
    this.members.set(worker.id, worker);
    this.router.register(worker);

    // 自动将 Worker 注册到调度器（若该 Worker 支持 processInbox）
    this.scheduler.register({
      workerId: worker.id,
      onReview: async () => {
        await worker.processInbox();
      },
    });
  }

  /** 移除成员 */
  removeWorker(id: string): void {
    this.members.delete(id);
    this.router.unregister(id);
    this.scheduler.unregister(id);
  }

  /** 获取所有成员 */
  getWorkers(): Participant[] {
    return [...this.members.values()];
  }

  // ─── Thread 管理 ─────────────────────────────────────────────────────────────

  /**
   * 发起一个新 Thread，返回 Thread 元信息。
   * 后续通过 send() 在此 Thread 内传递消息。
   */
  openThread(topic: string, participants: string[]): OrgThread {
    return this.threadManager.open(topic, participants);
  }

  /** 关闭 Thread */
  closeThread(threadId: string): void {
    this.threadManager.close(threadId);
  }

  /** 获取 Thread 的消息历史 */
  getMessages(threadId: string): OrgMessage[] {
    return this.threadManager.getMessages(threadId);
  }

  /** 获取所有 Thread */
  listThreads(): OrgThread[] {
    return this.threadManager.list();
  }

  // ─── 消息收发 ────────────────────────────────────────────────────────────────

  /**
   * 向指定 Worker 发送一条消息（在某个 Thread 内）。
   * 路由到目标 Worker，等待回复后将回复消息追加到 Thread。
   * @param from 发送方 ID，默认 'user'；Worker 间委托时传入发送方 Worker 的 ID
   */
  async send(to: string | string[], content: string, threadId: string, from = 'user'): Promise<OrgMessage[]> {
    const message: OrgMessage = {
      id: randomUUID(),
      threadId,
      from,
      to,
      content,
      timestamp: Date.now(),
    };

    this.threadManager.appendMessage(message);
    const replies = await this.router.route(message);

    for (const reply of replies) {
      this.threadManager.appendMessage(reply);
    }

    return replies;
  }

  /**
   * Participant 接口实现：Company 收到外部消息时，路由给 primary Worker。
   * （如果没有指定 primary，路由给第一个注册的 Worker）
   */
  async receive(message: OrgMessage): Promise<OrgMessage | null> {
    const replies = await this.router.route(message);
    return replies[0] ?? null;
  }

  describe(): string {
    const workerList = [...this.members.values()]
      .map(m => `  - ${m.describe()}`)
      .join('\n');
    return `【${this.profile.name}】包含以下员工：\n${workerList}`;
  }

  // ─── 统计查询 ────────────────────────────────────────────────────────────────

  /** 查询所有 Worker 的 Token 消耗汇总（管理后台接口） */
  getTokenSummaries(): WorkerTokenSummary[] {
    return this.tokenTracker.getAllSummaries();
  }

  /** 订阅组织事件（管理后台 / WebSocket 实时推送用） */
  onEvent(handler: (event: OrgEvent) => void): void {
    this.eventBus.on('org:event', handler);
  }

  /** 取消订阅 */
  offEvent(handler: (event: OrgEvent) => void): void {
    this.eventBus.off('org:event', handler);
  }
}
