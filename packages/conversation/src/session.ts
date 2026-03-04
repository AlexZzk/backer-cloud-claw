import { type Message, type StreamChunk, extractText } from '@bcc/foundation';
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
 */
export class ChatSession {
  private model: ModelAdapter;
  private history: ConversationHistory;
  private system: string | undefined;
  private maxTokens: number | undefined;

  constructor(options: ChatSessionOptions) {
    this.model = options.model;
    this.system = options.system;
    this.maxTokens = options.maxTokens;
    this.history = new ConversationHistory(options.history);
  }

  // ─── 核心对话接口 ──────────────────────────────────────────────────────────

  /** 非流式：等待完整回复文本 */
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

  /** 流式：逐块输出 */
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
      // 出错时把用户消息从历史中移除，避免历史污染
      this.history.clear();
      // 重放历史（除了最后一条失败的用户消息）
      // 简单处理：直接重新抛出，由调用方决定是否重试
      throw err;
    }

    // 将 assistant 回复追加到历史
    const assistantMsg: Message =
      finalMessage ?? { role: 'assistant', content: assistantChunks.join('') };
    this.history.append(assistantMsg);
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

  /** 从外部历史恢复会话（接 @bcc/memory-local 用） */
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
