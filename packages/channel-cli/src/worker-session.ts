/**
 * WorkerSession：将 @bcc/org 的 Worker 包装为 AgentInterface。
 *
 * REPL 和 CliChannel 针对 AgentInterface 编程，无需感知底层是 Worker 还是 AgentEngine。
 * WorkerSession 负责：
 *   - 将 REPL 的字符串输入转为 OrgMessage
 *   - 将 Worker.receiveStream() 的事件流转为 AgentChunk 流
 *   - 维护对话历史（OrgMessage 格式，按需转为 Message 格式供 /history 查看）
 *   - 收集并暴露 TokenUsage（供 /workers 命令查询统计）
 */

import { randomUUID } from 'node:crypto';
import type { AgentChunk, AgentInterface, Message, TokenUsage } from '@bcc/foundation';
import type { Worker } from '@bcc/org';
import type { TokenTracker } from '@bcc/org';

export class WorkerSession implements AgentInterface {
  private worker: Worker;
  private tokenTracker: TokenTracker;
  readonly threadId: string;

  /** 简化历史：[role, content] 对，供 getHistory / dumpHistory 使用 */
  private simpleHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /** 最近一次响应的 token 用量 */
  lastTokenUsage: TokenUsage | undefined;

  constructor(worker: Worker, tokenTracker: TokenTracker, threadId?: string) {
    this.worker = worker;
    this.tokenTracker = tokenTracker;
    this.threadId = threadId ?? randomUUID();
  }

  // ─── AgentInterface 实现 ─────────────────────────────────────────────────────

  get currentModel(): string {
    return this.worker.profile.modelId;
  }

  listModels(): string[] {
    return [this.worker.profile.modelId];
  }

  getHistory(): Message[] {
    return this.simpleHistory.map(h => ({ role: h.role, content: h.content }));
  }

  clearHistory(): void {
    this.simpleHistory = [];
  }

  dumpHistory(): string {
    return this.simpleHistory
      .map(h => `[${h.role === 'user' ? '用户' : this.worker.profile.name}]\n${h.content}`)
      .join('\n\n');
  }

  async *stream(userInput: string): AsyncIterable<AgentChunk> {
    this.simpleHistory.push({ role: 'user', content: userInput });
    this.lastTokenUsage = undefined;

    const message = {
      id: randomUUID(),
      threadId: this.threadId,
      from: 'user',
      to: this.worker.id,
      content: userInput,
      timestamp: Date.now(),
    };

    for await (const event of this.worker.receiveStream(message)) {
      if (event.type === 'chunk') {
        yield { type: 'text', text: event.text };
      } else {
        // done — 收集回复和 token 用量
        const reply = event.reply;
        this.simpleHistory.push({ role: 'assistant', content: reply.content });
        this.lastTokenUsage = reply.tokenUsage;

        if (reply.tokenUsage) {
          yield { type: 'done', tokenUsage: reply.tokenUsage };
        } else {
          yield { type: 'done' };
        }
      }
    }
  }

  // ─── Worker 信息透出 ──────────────────────────────────────────────────────────

  get workerId(): string {
    return this.worker.id;
  }

  get workerName(): string {
    return this.worker.profile.name;
  }

  get workerSkills(): string[] {
    return this.worker.profile.skills;
  }

  get workerDescription(): string {
    return this.worker.profile.description;
  }

  /** 本 Worker 的 Token 用量汇总（从共享 TokenTracker 读取） */
  getTokenSummary() {
    return this.tokenTracker.getSummary(this.worker.id);
  }
}

/**
 * WorkerRegistry：保存所有已创建的 WorkerSession，供 REPL 命令使用。
 */
export class WorkerRegistry {
  private sessions = new Map<string, WorkerSession>();

  register(session: WorkerSession): void {
    this.sessions.set(session.workerId, session);
  }

  find(id: string): WorkerSession | undefined {
    return this.sessions.get(id);
  }

  list(): WorkerSession[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }

  getPrimary(): WorkerSession | undefined {
    return this.sessions.values().next().value;
  }
}
