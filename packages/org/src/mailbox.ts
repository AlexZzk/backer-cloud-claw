import type { OrgMessage } from '@bcc/foundation';

type MessageHandler = (message: OrgMessage) => Promise<void>;

/**
 * Mailbox：Worker 的异步收件箱。
 *
 * 消息入队后按 FIFO 顺序依次触发注册的 handler，
 * 同一时刻只处理一条消息（串行化），防止并发对话混乱。
 */
export class Mailbox {
  private queue: OrgMessage[] = [];
  private handler: MessageHandler | null = null;
  private processing = false;

  /** 注册消息处理函数（Worker 初始化时调用一次） */
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /** 投递消息到收件箱 */
  async deliver(message: OrgMessage): Promise<void> {
    this.queue.push(message);
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.processing || !this.handler) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        await this.handler(msg);
      }
    } finally {
      this.processing = false;
    }
  }

  /** 当前队列长度（调试用） */
  get size(): number {
    return this.queue.length;
  }
}
