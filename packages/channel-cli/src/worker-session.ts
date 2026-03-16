/**
 * WorkerSession：将 @bcc/org 的 Worker 包装为 AgentInterface。
 *
 * REPL 和 CliChannel 针对 AgentInterface 编程，无需感知底层是 Worker 还是 AgentEngine。
 * WorkerSession 负责：
 *   - 将 REPL 的字符串输入转为 OrgMessage
 *   - 将 Worker.receiveStream() 的事件流转为 AgentChunk 流
 *   - 代理 Worker 的完整对话历史（含持久化恢复部分）
 *   - 会话结束时生成情节记忆摘要（非阻塞，失败不影响主流程）
 */

import { randomUUID } from 'node:crypto';
import type { AgentChunk, AgentInterface, EpisodicStore, Message, TokenUsage } from '@bcc/foundation';
import type { Worker } from '@bcc/org';
import type { TokenTracker } from '@bcc/org';
import type { EpisodeGenerator } from '@bcc/memory-episodic';

export class WorkerSession implements AgentInterface {
  private worker: Worker;
  private tokenTracker: TokenTracker;
  readonly threadId: string;

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

  /**
   * 返回底层 AgentEngine 的完整历史（含持久化恢复部分）。
   * 不再维护独立的 simpleHistory，避免两份历史不同步。
   */
  getHistory(): Message[] {
    return this.worker.getHistory();
  }

  clearHistory(): void {
    // AgentEngine.clearHistory() 通过 Worker → Engine 调用
    // 注意：clearHistory 不清除持久化文件，只清内存（与普通模式一致）
    // 需要时用户可手动删除 ~/.bcc/sessions/worker-{id}.json
    const history = this.worker.getHistory();
    history.length = 0;
  }

  dumpHistory(): string {
    return this.worker.getHistory()
      .map(m => {
        const role = m.role === 'user' ? '用户' : this.worker.profile.name;
        const text = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((c): c is { type: 'text'; text: string } => typeof c === 'object' && c.type === 'text')
                .map(c => c.text)
                .join('')
            : '';
        return `[${role}]\n${text}`;
      })
      .filter(s => s.split('\n')[1]?.trim())
      .join('\n\n');
  }

  async *stream(userInput: string): AsyncIterable<AgentChunk> {
    this.lastTokenUsage = undefined;

    // 在每次用户消息前，注入 Worker 当前状态上下文（未读消息 + 待处理任务）。
    // 这让 Worker 始终感知自己的"工作现场"，不再只是响应孤立的用户输入。
    const stateContext = await this.worker.getStateContext();
    const enrichedInput = stateContext
      ? `【当前状态提醒 - 你的工作现场】\n${stateContext}\n\n【本条消息】\n${userInput}`
      : userInput;

    const message = {
      id: randomUUID(),
      threadId: this.threadId,
      from: 'user',
      to: this.worker.id,
      content: enrichedInput,
      timestamp: Date.now(),
    };

    for await (const event of this.worker.receiveStream(message)) {
      if (event.type === 'chunk') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_call' || event.type === 'tool_result') {
        // 透传工具事件（CLI 的 REPL 会展示工具调用进度）
        yield event;
      } else {
        // done
        const reply = event.reply;
        this.lastTokenUsage = reply.tokenUsage;

        if (reply.tokenUsage) {
          yield { type: 'done', tokenUsage: reply.tokenUsage };
        } else {
          yield { type: 'done' };
        }
      }
    }
  }

  // ─── 情节记忆：会话结束时生成摘要 ──────────────────────────────────────────

  /**
   * 生成并保存本次会话的情节摘要（应在会话结束时调用）。
   *
   * 该方法是非阻塞的：调用方不需要等待完成，失败也不会影响主流程。
   * 设计为 async 以允许调用方 await（如有必要）。
   *
   * @param store     情节存储后端（FileEpisodicStore 或任意 EpisodicStore 实现）
   * @param generator 摘要生成器（使用 LLM 生成自然语言摘要）
   * @param sessionId 本次会话 ID（用于 Episode 归属，通常是 worker-{id}）
   */
  async summarize(
    store: EpisodicStore,
    generator: EpisodeGenerator,
    sessionId: string,
  ): Promise<void> {
    const history = this.worker.getHistory();
    if (history.length < 2) return;  // 内容不足，不值得摘要

    try {
      const episode = await generator.generate(this.worker.id, sessionId, history);
      if (episode) {
        await store.append(episode);
      }
    } catch {
      // 摘要失败不抛出，不影响用户体验
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
