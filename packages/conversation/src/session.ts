import { type Message, type StreamChunk, type MemoryStore, extractText } from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';
import { ModelRouter } from '@bcc/model-core';
import { ConversationHistory, type HistoryOptions } from './history.js';

export interface ChatSessionOptions {
  /**
   * 单个模型适配器，或已配置好的 ModelRouter。
   * 如果传入 ModelRouter，手动切换和故障转移均由 Router 管理。
   */
  model: ModelAdapter;

  /** 系统提示词 */
  system?: string;

  /** 历史记录配置 */
  history?: HistoryOptions;

  /** 最大生成 token 数 */
  maxTokens?: number;

  /**
   * 持久化存储后端（可选）。
   * 提供后，每次对话结束会自动保存历史。
   * 不提供则仅保存在内存中，进程退出后丢失。
   *
   * 示例：
   *   memory: new FileMemoryStore({ dir: '~/.bcc/sessions' })
   *   memory: new MyVectorStore({ endpoint: '...' })
   */
  memory?: MemoryStore;

  /**
   * 会话 ID，用于持久化存储的键名。
   * 提供 memory 时必须同时提供，否则历史无法关联到正确的会话。
   * 示例：'user-123', 'project-abc-chat'
   */
  sessionId?: string;
}

export interface ChatResult {
  text: string;
  message: Message;
}

/**
 * ChatSession：单次会话的完整生命周期管理。
 *
 * 功能：
 *   - 多轮对话（自动携带历史）
 *   - 会话内记忆（ConversationHistory）
 *   - 流式输出
 *   - 运行时切换模型（场景 B，需要传入 ModelRouter）
 *   - 故障转移（场景 A，由 ModelRouter 自动处理）
 *   - 可选持久化（任意 MemoryStore 实现，如 FileMemoryStore）
 *
 * 使用持久化：
 *   const session = await ChatSession.create({
 *     model, sessionId: 'my-chat', memory: new FileMemoryStore()
 *   });
 *
 * 不使用持久化（仅内存）：
 *   const session = new ChatSession({ model });
 */
export class ChatSession {
  private model: ModelAdapter;
  private history: ConversationHistory;
  private system: string | undefined;
  private maxTokens: number | undefined;
  private memory: MemoryStore | undefined;
  private sessionId: string | undefined;

  constructor(options: ChatSessionOptions) {
    this.model = options.model;
    this.system = options.system;
    this.maxTokens = options.maxTokens;
    this.history = new ConversationHistory(options.history);
    this.memory = options.memory;
    this.sessionId = options.sessionId;
  }

  /**
   * 工厂方法：创建会话并自动从持久化存储恢复历史。
   *
   * 若 memory 和 sessionId 都提供，则尝试加载已有历史；
   * 否则等价于直接 `new ChatSession(options)`。
   */
  static async create(options: ChatSessionOptions): Promise<ChatSession> {
    const session = new ChatSession(options);
    if (options.memory && options.sessionId) {
      const saved = await options.memory.load(options.sessionId);
      if (saved.length > 0) session.restoreHistory(saved);
    }
    return session;
  }

  // ─── 核心对话接口 ──────────────────────────────────────────────────────────

  /** 非流式：等待完整回复文本，并自动持久化 */
  async chat(userInput: string): Promise<ChatResult> {
    const chunks: string[] = [];
    let finalMessage: Message | undefined;

    for await (const chunk of this.stream(userInput)) {
      if (chunk.type === 'text' && chunk.text) {
        chunks.push(chunk.text);
      }
      if (chunk.type === 'done' && chunk.message) {
        finalMessage = chunk.message;
      }
    }

    const text = chunks.join('');
    const message = finalMessage ?? { role: 'assistant' as const, content: text };
    return { text, message };
  }

  /** 流式：逐块输出，done chunk 发送后自动持久化 */
  async *stream(userInput: string): AsyncIterable<StreamChunk> {
    const userMsg: Message = { role: 'user', content: userInput };
    this.history.append(userMsg);

    const assistantChunks: string[] = [];
    let finalMessage: Message | undefined;

    try {
      for await (const chunk of this.model.stream({
        messages: this.history.getAll(),
        system: this.system,
        maxTokens: this.maxTokens,
      })) {
        if (chunk.type === 'text' && chunk.text) {
          assistantChunks.push(chunk.text);
        }
        if (chunk.type === 'done' && chunk.message) {
          finalMessage = chunk.message;
        }
        yield chunk;
      }
    } catch (err) {
      // 出错时回滚最后一条用户消息，避免历史污染
      const all = this.history.getAll();
      this.restoreHistory(all.slice(0, -1));
      throw err;
    }

    // 追加 assistant 回复
    const assistantMsg: Message =
      finalMessage ?? { role: 'assistant', content: assistantChunks.join('') };
    this.history.append(assistantMsg);

    // 自动持久化
    await this.persist();
  }

  // ─── 持久化操作 ────────────────────────────────────────────────────────────

  /**
   * 手动保存当前历史到持久化存储。
   * `chat()` / `stream()` 结束时会自动调用，无需手动触发。
   * 若未配置 memory，此方法为空操作。
   */
  async persist(): Promise<void> {
    if (this.memory && this.sessionId) {
      await this.memory.save(this.sessionId, this.history.getAll());
    }
  }

  /**
   * 从持久化存储重新加载历史（覆盖当前内存中的历史）。
   * 若未配置 memory，此方法为空操作。
   */
  async reload(): Promise<void> {
    if (this.memory && this.sessionId) {
      const saved = await this.memory.load(this.sessionId);
      if (saved.length > 0) this.restoreHistory(saved);
    }
  }

  // ─── 模型切换（场景 B）────────────────────────────────────────────────────

  /**
   * 切换到指定模型（历史保留）。
   * 需要 model 是 ModelRouter 实例。
   */
  switchModel(modelId: string): void {
    if (!(this.model instanceof ModelRouter)) {
      throw new Error(
        'switchModel() requires a ModelRouter. Pass ModelRouter as the model option.',
      );
    }
    this.model.switchTo(modelId);
  }

  /** 获取当前使用的模型 id */
  get currentModel(): string {
    if (this.model instanceof ModelRouter) {
      return this.model.currentModelId;
    }
    return this.model.id;
  }

  /** 查看可用模型列表（仅 ModelRouter 下有效） */
  listModels(): string[] {
    if (this.model instanceof ModelRouter) {
      return this.model.listModels().map(m => m.id);
    }
    return [this.model.id];
  }

  // ─── 历史管理 ─────────────────────────────────────────────────────────────

  getHistory(): Message[] {
    return this.history.getAll();
  }

  clearHistory(): void {
    this.history.clear();
  }

  /** 手动追加消息（适合注入上下文） */
  injectMessage(message: Message): void {
    this.history.append(message);
  }

  /** 从消息数组恢复历史 */
  restoreHistory(messages: Message[]): void {
    this.history.clear();
    for (const msg of messages) {
      this.history.append(msg);
    }
  }

  /** 导出历史文本（用于调试） */
  dumpHistory(): string {
    return this.history
      .getAll()
      .map(m => `[${m.role}] ${extractText(m)}`)
      .join('\n');
  }
}
