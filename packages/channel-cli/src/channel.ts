import type { AgentInterface, MemoryStore } from '@bcc/foundation';
import { ChatSession, type ChatSessionOptions } from '@bcc/conversation';
import type { ModelAdapter } from '@bcc/model-core';
import type { AgentRegistry } from '@bcc/agents';
import { bold, cyan, dim, green } from './ansi.js';
import { startRepl } from './repl.js';
import type { WorkerRegistry } from './worker-session.js';

export interface CliChannelOptions {
  /**
   * 传入已构建好的 AgentInterface（如 AgentEngine 或 BccAgent）。
   * 与 model 二选一。
   */
  agent?: AgentInterface | undefined;

  /**
   * 多 Agent 注册表（可选）。当 agent 为 BccAgent 时配合使用。
   * 用于 /agents、/agent 命令列举和切换 Agent。
   */
  agentRegistry?: AgentRegistry | undefined;

  /**
   * Worker 注册表（新 Org 模式）。
   * 用于 /workers、/worker 命令列举和切换 Worker。
   */
  workerRegistry?: WorkerRegistry | undefined;

  /**
   * 模型适配器或 ModelRouter（CliChannel 内部自动创建 ChatSession）。
   * 与 agent 二选一。
   */
  model?: ModelAdapter | undefined;

  // ── 以下选项仅在使用 model 时有效 ─────────────────────────────────────────

  /** 系统提示词 */
  system?: string | undefined;

  /** 持久化存储（可选） */
  memory?: MemoryStore | undefined;

  /** 会话 ID，用于持久化（默认 'default'） */
  sessionId?: string | undefined;

  /** 单次对话最大 token 数 */
  maxTokens?: number | undefined;

  /** 保留的最大历史消息数 */
  maxMessages?: number | undefined;

  // ── 通用选项 ──────────────────────────────────────────────────────────────

  /** 终端横幅 */
  banner?: string | undefined;
}

/**
 * CliChannel：交互式命令行对话渠道。
 *
 * 两种用法：
 *
 * A. 简单对话（传入 model，内部自动建立 ChatSession）：
 *   const cli = await CliChannel.create({ model: new ClaudeAdapter() });
 *
 * B. 带工具的 Agent（传入 AgentEngine）：
 *   const engine = await AgentEngine.create({ model, tools: [...] });
 *   const cli = await CliChannel.create({ agent: engine });
 */
export class CliChannel {
  private session: AgentInterface;
  private options: CliChannelOptions;

  private constructor(session: AgentInterface, options: CliChannelOptions) {
    this.session = session;
    this.options = options;
  }

  static async create(options: CliChannelOptions): Promise<CliChannel> {
    if (!options.agent && !options.model) {
      throw new Error('CliChannel.create() 需要提供 agent 或 model 之一。');
    }

    let session: AgentInterface;

    if (options.agent) {
      // 直接使用传入的 AgentInterface（AgentEngine 等）
      session = options.agent;

      const restored = session.getHistory().length > 0;
      if (restored) {
        console.log(green('✓') + ` 已恢复 ${session.getHistory().length} 条历史消息`);
      }
    } else {
      // 用 model 自动创建 ChatSession
      const sessionOpts: ChatSessionOptions = {
        model: options.model!,
        sessionId: options.sessionId ?? 'default',
        ...(options.system !== undefined && { system: options.system }),
        ...(options.memory !== undefined && { memory: options.memory }),
        ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
        ...(options.maxMessages !== undefined && { history: { maxMessages: options.maxMessages } }),
      };

      session = await ChatSession.create(sessionOpts);

      const restored = options.memory !== undefined && session.getHistory().length > 0;
      if (restored) {
        console.log(green('✓') + ` 已从存储恢复 ${session.getHistory().length} 条历史消息`);
      }
    }

    return new CliChannel(session, options);
  }

  /** 启动交互式 REPL */
  async start(): Promise<void> {
    const banner = this.options.banner ?? this.defaultBanner();
    const hint = this.buildHint();
    await startRepl({
      session: this.session,
      banner,
      hint,
      ...(this.options.agentRegistry  !== undefined && { agentRegistry:  this.options.agentRegistry }),
      ...(this.options.workerRegistry !== undefined && { workerRegistry: this.options.workerRegistry }),
    });
  }

  /** 获取底层 AgentInterface */
  get agentSession(): AgentInterface {
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
    const parts: string[] = [`  模型：${this.session.currentModel}`];

    if (this.options.workerRegistry) {
      const reg = this.options.workerRegistry;
      const current = this.session as import('./worker-session.js').WorkerSession;
      parts.push(`  [Worker 模式 | 当前：${current.workerName ?? '?'} | 共 ${reg.size} 名员工]`);
    } else if (this.options.agentRegistry) {
      const reg = this.options.agentRegistry;
      const primary = reg.getPrimary();
      const name = primary?.def.name ?? 'Agent';
      parts.push(`  [多 Agent 模式 | 主 Agent：${name} | 共 ${reg.size} 个 Agent]`);
    } else if (this.options.agent) {
      parts.push('  [Agent 模式]');
    } else if (this.options.memory !== undefined) {
      const id = this.options.sessionId ?? 'default';
      parts.push(`  会话：${id}（自动保存）`);
    }

    return parts.join('  |  ');
  }
}
