import type { Message } from '@bcc/foundation';

export interface HistoryOptions {
  /**
   * 保留的最大消息条数（超出时裁剪最旧的消息，system 消息始终保留）。
   * 默认不限制。
   */
  maxMessages?: number;
}

/**
 * 会话内记忆：管理当前会话的消息历史。
 * 不持久化，会话结束后丢失（持久化由 @bcc/memory-local 等模块负责）。
 */
export class ConversationHistory {
  private messages: Message[] = [];
  private maxMessages: number;

  constructor(options: HistoryOptions = {}) {
    this.maxMessages = options.maxMessages ?? Infinity;
  }

  append(message: Message): void {
    this.messages.push(message);
    this.trim();
  }

  getAll(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }

  private trim(): void {
    if (this.messages.length <= this.maxMessages) return;
    // 保留 system 消息，从头裁剪非 system 消息
    const nonSystem = this.messages.filter(m => m.role !== 'system');
    const system = this.messages.filter(m => m.role === 'system');
    const keep = nonSystem.slice(-(this.maxMessages - system.length));
    this.messages = [...system, ...keep];
  }
}
