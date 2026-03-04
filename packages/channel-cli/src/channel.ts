import { ChatSession, type ChatSessionOptions } from '@bcc/conversation';
import type { MemoryStore } from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';
import { bold, cyan, dim, green } from './ansi.js';
import { startRepl } from './repl.js';

export interface CliChannelOptions {
  /** 模型适配器或 ModelRouter */
  model: ModelAdapter;

  /** 系统提示词（Agent 人格/行为定义） */
  system?: string | undefined;

  /**
   * 持久化存储（可选）。
   * 不提供则历史仅保存在内存，进程退出后丢失。
   */
  memory?: MemoryStore | undefined;

  /**
   * 会话 ID，用于持久化。
   * 提供 memory 时建议同时设置，默认 'default'。
   */
  sessionId?: string | undefined;

  /** 单次对话最大 token 数 */
  maxTokens?: number | undefined;

  /** 保留的最大历史消息数 */
  maxMessages?: number | undefined;

  /** 终端横幅（不设置则使用默认横幅） */
  banner?: string | undefined;
}

/**
 * CliChannel：交互式命令行对话渠道。
 *
 * 用法：
 *   const cli = new CliChannel({ model: new ClaudeAdapter() });
 *   await cli.start();
 *
 * 或使用工厂方法（支持持久化历史恢复）：
 *   const cli = await CliChannel.create({ model, memory, sessionId: 'my-chat' });
 *   await cli.start();
 */
export class CliChannel {
  private session: ChatSession;
  private options: CliChannelOptions;

  private constructor(session: ChatSession, options: CliChannelOptions) {
    this.session = session;
    this.options = options;
  }

  /**
   * 创建 CliChannel 并自动从持久化存储恢复历史。
   * 如果不需要持久化，直接使用 `new CliChannel(options)` 即可。
   */
  static async create(options: CliChannelOptions): Promise<CliChannel> {
    const sessionOpts: ChatSessionOptions = {
      model: options.model,
      sessionId: options.sessionId ?? 'default',
      ...(options.system !== undefined && { system: options.system }),
      ...(options.memory !== undefined && { memory: options.memory }),
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
      ...(options.maxMessages !== undefined && { history: { maxMessages: options.maxMessages } }),
    };

    const session = await ChatSession.create(sessionOpts);

    const restored = options.memory
      ? session.getHistory().length > 0
      : false;

    if (restored) {
      console.log(
        green('✓') + ` 已从存储恢复 ${session.getHistory().length} 条历史消息`,
      );
    }

    return new CliChannel(session, options);
  }

  /** 启动交互式 REPL */
  async start(): Promise<void> {
    const banner = this.options.banner ?? this.defaultBanner();
    const hint = this.buildHint();
    await startRepl({ session: this.session, banner, hint });
  }

  /** 获取底层 ChatSession（用于高级控制） */
  get chatSession(): ChatSession {
    return this.session;
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private defaultBanner(): string {
    return [
      '',
      bold(cyan('  backer-cloud-claw')),
      dim('  模块化 AI 对话框架'),
    ].join('\n');
  }

  private buildHint(): string {
    const parts: string[] = [];
    parts.push(`  模型：${this.session.currentModel}`);
    if (this.options.memory) {
      const id = this.options.sessionId ?? 'default';
      parts.push(`  会话：${id}（自动保存）`);
    }
    return parts.join('  |  ');
  }
}
