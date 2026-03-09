import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  OrgEvent,
  OrgMessage,
  Participant,
  Tool,
  TokenUsage,
  WorkerProfile,
} from '@bcc/foundation';
import { AgentEngine, type AgentEngineOptions } from '@bcc/agent-engine';
import { Mailbox } from './mailbox.js';
import { TokenTracker } from './token-tracker.js';

export interface WorkerOptions {
  /** Worker 身份信息 */
  profile: WorkerProfile;
  /** AgentEngine 构造参数（model、system、tools、memory 等） */
  engineOptions: AgentEngineOptions;
  /** 共享的 TokenTracker（通常来自所属 Company） */
  tokenTracker?: TokenTracker;
  /** 共享的事件总线（通常来自所属 Company） */
  eventBus?: EventEmitter;
}

/**
 * Worker：具有身份、技能、记忆的 AI 员工。
 *
 * 每个 Worker 绑定一个具体的模型（Claude / Qwen / DeepSeek 等），
 * 通过 `profile` 获得独特的角色定位和技能描述。
 *
 * 创建方式（因 AgentEngine 需异步初始化）：
 *   const worker = await Worker.create({ profile, engineOptions });
 *
 * 消息传递流程：
 *   外部调用 receive(message)
 *     → AgentEngine 处理
 *     → 生成回复 OrgMessage（含 tokenUsage）
 *     → emit 事件到事件总线
 */
export class Worker implements Participant {
  readonly profile: WorkerProfile;
  readonly inbox: Mailbox;

  private engine: AgentEngine;
  private tokenTracker: TokenTracker;
  private eventBus: EventEmitter;

  private constructor(
    profile: WorkerProfile,
    engine: AgentEngine,
    tokenTracker: TokenTracker,
    eventBus: EventEmitter,
  ) {
    this.profile = profile;
    this.engine = engine;
    this.tokenTracker = tokenTracker;
    this.eventBus = eventBus;
    this.inbox = new Mailbox();

    // Mailbox 串行化处理：消息入队后依次调用 _process，丢弃返回值
    this.inbox.onMessage(async (msg) => {
      await this._process(msg);
    });
  }

  /**
   * 工厂方法：异步创建 Worker（等待 AgentEngine 初始化完成）。
   */
  static async create(options: WorkerOptions): Promise<Worker> {
    const engine = await AgentEngine.create(options.engineOptions);
    const tokenTracker = options.tokenTracker ?? new TokenTracker();
    const eventBus = options.eventBus ?? new EventEmitter();
    return new Worker(options.profile, engine, tokenTracker, eventBus);
  }

  get id(): string {
    return this.profile.id;
  }

  /**
   * 接收一条 OrgMessage，驱动 AgentEngine 处理并返回回复消息。
   */
  async receive(message: OrgMessage): Promise<OrgMessage | null> {
    this.eventBus.emit('org:event', {
      type: 'message:received',
      workerId: this.id,
      message,
    } satisfies OrgEvent);

    return this._process(message);
  }

  /**
   * 流式接收：产生文字片段事件流，适合实时展示 Worker 的思考过程。
   */
  async *receiveStream(
    message: OrgMessage,
  ): AsyncIterable<{ type: 'chunk'; text: string } | { type: 'done'; reply: OrgMessage }> {
    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: message.threadId,
    } satisfies OrgEvent);

    let accumulatedText = '';
    let tokenUsage: TokenUsage | undefined;

    for await (const chunk of this.engine.stream(message.content)) {
      if (chunk.type === 'text' && chunk.text) {
        accumulatedText += chunk.text;
        yield { type: 'chunk', text: chunk.text };
      }
      if (chunk.type === 'done') {
        tokenUsage = chunk.tokenUsage;
      }
    }

    const reply = this._buildReply(message, accumulatedText, tokenUsage);
    this._recordAndEmit(message.threadId, tokenUsage, reply);
    yield { type: 'done', reply };
  }

  /** 注册工具（运行时追加技能） */
  registerTool(tool: Tool): void {
    this.engine.registerTool(tool);
  }

  describe(): string {
    const skillList = this.profile.skills.length > 0
      ? `技能：${this.profile.skills.join('、')}`
      : '无特定技能';
    return `【${this.profile.name}】${this.profile.role}。${this.profile.description}。${skillList}。`;
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────────────

  private async _process(message: OrgMessage): Promise<OrgMessage | null> {
    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: message.threadId,
    } satisfies OrgEvent);

    let accumulatedText = '';
    let tokenUsage: TokenUsage | undefined;

    for await (const chunk of this.engine.stream(message.content)) {
      if (chunk.type === 'text' && chunk.text) {
        accumulatedText += chunk.text;
      }
      if (chunk.type === 'done') {
        tokenUsage = chunk.tokenUsage;
      }
    }

    if (!accumulatedText) return null;

    const reply = this._buildReply(message, accumulatedText, tokenUsage);
    this._recordAndEmit(message.threadId, tokenUsage, reply);
    return reply;
  }

  private _buildReply(
    incomingMessage: OrgMessage,
    text: string,
    tokenUsage?: TokenUsage,
  ): OrgMessage {
    const to = Array.isArray(incomingMessage.to)
      ? incomingMessage.to.filter(id => id !== this.id).concat([incomingMessage.from])
      : incomingMessage.from;

    const base = {
      id: randomUUID(),
      threadId: incomingMessage.threadId,
      from: this.id,
      to,
      content: text,
      timestamp: Date.now(),
    };

    // exactOptionalPropertyTypes: 仅在有值时才包含 tokenUsage 字段
    return tokenUsage ? { ...base, tokenUsage } : base;
  }

  private _recordAndEmit(threadId: string, tokenUsage: TokenUsage | undefined, reply: OrgMessage): void {
    const usage = tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.tokenTracker.record(this.id, threadId, usage);

    this.eventBus.emit('org:event', {
      type: 'worker:done',
      workerId: this.id,
      threadId,
      tokenUsage: usage,
    } satisfies OrgEvent);

    this.eventBus.emit('org:event', {
      type: 'message:sent',
      workerId: this.id,
      message: reply,
    } satisfies OrgEvent);
  }
}
