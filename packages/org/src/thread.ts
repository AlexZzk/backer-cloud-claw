import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { OrgEvent, OrgMessage, OrgThread } from '@bcc/foundation';

/**
 * ThreadManager：管理组织内所有 Thread 的生命周期和消息历史。
 *
 * Thread 是参与者之间一次持续对话的上下文容器，
 * 可以是 1-1 对话（用户 ↔ Worker）或多人群组（PM → PjM → Arch → Dev）。
 */
export class ThreadManager {
  private threads = new Map<string, OrgThread>();
  private messages = new Map<string, OrgMessage[]>();
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
  }

  /** 创建一个新 Thread */
  open(topic: string, participants: string[]): OrgThread {
    const thread: OrgThread = {
      id: randomUUID(),
      topic,
      participants,
      status: 'active',
      createdAt: Date.now(),
    };
    this.threads.set(thread.id, thread);
    this.messages.set(thread.id, []);

    this.eventBus.emit('org:event', {
      type: 'thread:opened',
      thread,
    } satisfies OrgEvent);

    return thread;
  }

  /** 追加消息到 Thread */
  appendMessage(message: OrgMessage): void {
    const msgs = this.messages.get(message.threadId);
    if (msgs) msgs.push(message);
  }

  /** 关闭 Thread */
  close(threadId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread || thread.status === 'closed') return;

    thread.status = 'closed';
    thread.closedAt = Date.now();

    const msgs = this.messages.get(threadId) ?? [];
    const totalTokens = msgs.reduce((s, m) => s + (m.tokenUsage?.totalTokens ?? 0), 0);

    this.eventBus.emit('org:event', {
      type: 'thread:closed',
      thread,
      totalTokens,
    } satisfies OrgEvent);
  }

  /** 获取 Thread 元数据 */
  get(threadId: string): OrgThread | undefined {
    return this.threads.get(threadId);
  }

  /** 获取 Thread 的消息历史 */
  getMessages(threadId: string): OrgMessage[] {
    return this.messages.get(threadId) ?? [];
  }

  /** 获取所有 Thread（按创建时间倒序） */
  list(): OrgThread[] {
    return [...this.threads.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}
