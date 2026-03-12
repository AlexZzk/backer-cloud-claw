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

// ─── 异步消息 & 任务服务的轻量接口（避免在 @bcc/org 中直接依赖 @bcc/messaging / @bcc/task）────

/**
 * AsyncInboxService：Worker 的异步收件箱服务接口。
 *
 * @bcc/org 通过此接口与 @bcc/messaging 解耦：
 * 上层 Company / 应用负责注入具体实现，Worker 只依赖这个轻量接口。
 */
export interface AsyncInboxService {
  /** 获取该 Worker 的所有未读聊天消息，按时间升序 */
  getPendingMessages(workerId: string): Promise<Array<{
    chat: { id: string; title?: string; participants: string[] };
    message: { id: string; chatId: string; from: string; content: string; timestamp: number };
  }>>;

  /** 将某个会话的消息标记为已读 */
  markRead(chatId: string, participantId: string): Promise<void>;

  /**
   * 打开（或创建）两人之间的私聊会话，返回会话信息。
   * 幂等：两人之间已有 active 会话时直接返回现有会话。
   */
  openDirectChat(
    participant1: string,
    participant2: string,
  ): Promise<{ id: string; participants: string[] }>;

  /**
   * 创建群聊会话（三人及以上）。
   */
  createGroupChat(
    participants: string[],
    title?: string,
  ): Promise<{ id: string; participants: string[]; title?: string }>;

  /**
   * 列出某参与者相关的所有会话。
   */
  listChats(participantId?: string): Promise<Array<{
    id: string; type: string; participants: string[]; title?: string; status: string;
  }>>;

  /** 异步发送一条消息（不等待接收方处理） */
  post(
    chatId: string,
    from: string,
    content: string,
    options?: { replyToId?: string; taskId?: string },
  ): Promise<{ id: string; chatId: string; from: string; content: string; timestamp: number }>;

  /** 获取某会话最近的消息历史（注入对话上下文用） */
  getMessages(chatId: string, limit?: number): Promise<Array<{
    id: string; from: string; content: string; timestamp: number;
  }>>;
}

/**
 * AsyncTaskService：Worker 的任务管理服务接口。
 * 与 @bcc/task 的 TaskManager 兼容，但 Worker 只依赖此轻量接口。
 */
export interface AsyncTaskService {
  /** 创建任务 */
  create(options: {
    title: string;
    description: string;
    priority?: string;
    createdBy: string;
    chatId?: string;
    messageId?: string;
  }): Promise<{ id: string; title: string; status: string; priority: string }>;

  /** 更新任务状态 */
  updateStatus(taskId: string, status: string): Promise<{ id: string; title: string; status: string } | null>;

  /** 列出任务（可按状态过滤） */
  list(statusFilter?: string[]): Promise<Array<{ id: string; title: string; description: string; status: string; priority: string }>>;

  /** 获取任务摘要（可注入 LLM 上下文） */
  formatSummaryForPrompt(): Promise<string>;
}

export interface WorkerOptions {
  /** Worker 身份信息 */
  profile: WorkerProfile;
  /** AgentEngine 构造参数（model、system、tools、memory 等） */
  engineOptions: AgentEngineOptions;
  /**
   * 可选：用于后台心跳/收件箱审视的轻量 AgentEngine 选项。
   *
   * 设置后，Worker.processInbox()（由 WorkerScheduler 定期触发）
   * 使用此独立引擎处理未读消息，而非主对话引擎（engineOptions）。
   *
   * 典型用法：主模型用 claude-opus（贵），审视模型用 claude-haiku（便宜），
   * 心跳处理不消耗主模型 Token，大幅降低后台审视成本。
   */
  reviewEngineOptions?: AgentEngineOptions;
  /** 共享的 TokenTracker（通常来自所属 Company） */
  tokenTracker?: TokenTracker;
  /** 共享的事件总线（通常来自所属 Company） */
  eventBus?: EventEmitter;
  /**
   * 异步收件箱服务（可选）。
   * 注入后 Worker 会自动注册 send_message 等工具，并支持 processInbox()。
   */
  inboxService?: AsyncInboxService;
  /**
   * 任务管理服务（可选）。
   * 注入后 Worker 会自动注册 create_task / update_task / list_tasks 工具。
   */
  taskService?: AsyncTaskService;
}

/**
 * Worker：具有身份、技能、记忆的 AI 员工。
 *
 * 每个 Worker 绑定一个具体的模型（Claude / Qwen / DeepSeek 等），
 * 通过 `profile` 获得独特的角色定位和技能描述。
 *
 * ## 两种通信模式
 *
 * ### 同步模式（旧）：receive()
 * 调用方阻塞等待 Worker 生成回复，适用于简单的单轮问答。
 *
 * ### 异步模式（新）：processInbox()
 * 类比飞书/微信：
 * - 其他 Worker 或用户通过 AsyncInboxService 发送消息（不阻塞）
 * - Worker 在"工作审视周期"中调用 processInbox() 检查未读消息
 * - Worker 阅读消息后生成回复，再通过 AsyncInboxService.post() 发回
 * - 整个流程完全异步，不阻塞任何一方
 *
 * 创建方式：
 *   const worker = await Worker.create({ profile, engineOptions });
 */
export class Worker implements Participant {
  readonly profile: WorkerProfile;
  readonly inbox: Mailbox;

  private engine: AgentEngine;
  /** 可选的审视引擎（心跳/收件箱处理用），用更便宜的模型降低后台成本 */
  private reviewEngine: AgentEngine | undefined;
  private tokenTracker: TokenTracker;
  private eventBus: EventEmitter;
  private inboxService: AsyncInboxService | undefined;
  private taskService: AsyncTaskService | undefined;

  private constructor(
    profile: WorkerProfile,
    engine: AgentEngine,
    tokenTracker: TokenTracker,
    eventBus: EventEmitter,
    inboxService?: AsyncInboxService,
    taskService?: AsyncTaskService,
    reviewEngine?: AgentEngine,
  ) {
    this.profile = profile;
    this.engine = engine;
    this.reviewEngine = reviewEngine;
    this.tokenTracker = tokenTracker;
    this.eventBus = eventBus;
    this.inboxService = inboxService;
    this.taskService = taskService;
    this.inbox = new Mailbox();

    // Mailbox 串行化处理：消息入队后依次调用 _process，丢弃返回值
    this.inbox.onMessage(async (msg) => {
      await this._process(msg);
    });
  }

  /**
   * 工厂方法：异步创建 Worker（等待 AgentEngine 初始化完成）。
   * 若注入了 inboxService / taskService，会自动注册对应的 LLM 工具。
   */
  static async create(options: WorkerOptions): Promise<Worker> {
    const engine = await AgentEngine.create(options.engineOptions);
    const reviewEngine = options.reviewEngineOptions
      ? await AgentEngine.create(options.reviewEngineOptions)
      : undefined;
    const tokenTracker = options.tokenTracker ?? new TokenTracker();
    const eventBus = options.eventBus ?? new EventEmitter();

    const worker = new Worker(
      options.profile,
      engine,
      tokenTracker,
      eventBus,
      options.inboxService,
      options.taskService,
      reviewEngine,
    );

    // 自动注册 inbox / task 工具
    if (options.inboxService) {
      worker._registerInboxTools(options.inboxService);
    }
    if (options.taskService) {
      worker._registerTaskTools(options.taskService);
    }

    return worker;
  }

  get id(): string {
    return this.profile.id;
  }

  // ─── 同步通信（保持向后兼容）────────────────────────────────────────────────

  /**
   * 接收一条 OrgMessage，驱动 AgentEngine 处理并返回回复消息。
   * （旧的同步通信模式，适用于简单场景）
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

    for await (const chunk of this.engine.stream(this._buildEngineInput(message))) {
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

  // ─── 异步收件箱处理（新通信模式）────────────────────────────────────────────

  /**
   * 处理收件箱中的所有未读消息（异步通信模式的核心方法）。
   *
   * 工作流程：
   * 1. 从 AsyncInboxService 获取所有未读消息
   * 2. 按会话分组，为每条消息构建上下文（含历史消息）
   * 3. 调用 AgentEngine 生成回复
   * 4. 通过 AsyncInboxService.post() 发回回复
   * 5. 标记消息为已读
   * 6. 如果注入了 TaskService，生成回复前先注入任务上下文
   *
   * 此方法由 WorkerScheduler 定期调用，也可手动触发。
   */
  async processInbox(): Promise<void> {
    if (!this.inboxService) return;

    const pending = await this.inboxService.getPendingMessages(this.id);

    if (pending.length === 0) {
      this.eventBus.emit('org:event', {
        type: 'worker:inbox:checked',
        workerId: this.id,
        pendingCount: 0,
      } satisfies OrgEvent);
      return;
    }

    this.eventBus.emit('org:event', {
      type: 'worker:inbox:checked',
      workerId: this.id,
      pendingCount: pending.length,
    } satisfies OrgEvent);

    // 按会话分组：同一个 chatId 的消息批量处理，减少重复加载上下文
    const byChat = new Map<string, typeof pending>();
    for (const item of pending) {
      const group = byChat.get(item.chat.id) ?? [];
      group.push(item);
      byChat.set(item.chat.id, group);
    }

    for (const [chatId, items] of byChat) {
      await this._processChatMessages(chatId, items);
    }
  }

  // ─── 工具注册（运行时追加技能）──────────────────────────────────────────────

  /** 注册工具（运行时追加技能） */
  registerTool(tool: Tool): void {
    this.engine.registerTool(tool);
  }

  // ─── 辅助方法 ────────────────────────────────────────────────────────────────

  /**
   * 获取底层 AgentEngine 的完整对话历史（LLM 协议格式）。
   * 包含从持久化存储恢复的历史，供 WorkerSession.getHistory() 和情节摘要使用。
   */
  getHistory() {
    return this.engine.getHistory();
  }

  /**
   * 获取 Worker 当前状态的文本摘要。
   * 用于在对话开始前注入上下文，让 Worker 始终知道：
   *   - 有没有未读消息等待处理
   *   - 当前任务进展如何
   *
   * WorkerSession 在每次 stream() 前调用此方法，将结果前置到用户消息。
   */
  async getStateContext(): Promise<string> {
    const parts: string[] = [];

    if (this.inboxService) {
      const pending = await this.inboxService.getPendingMessages(this.id);
      if (pending.length > 0) {
        const preview = pending
          .slice(0, 5)
          .map(p => {
            const time = new Date(p.message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const preview = p.message.content.length > 60
              ? p.message.content.slice(0, 60) + '…'
              : p.message.content;
            return `  • ${p.message.from}（${time}）：${preview}`;
          })
          .join('\n');
        const more = pending.length > 5 ? `\n  …以及 ${pending.length - 5} 条更多` : '';
        parts.push(`📬 你有 ${pending.length} 条未读消息：\n${preview}${more}`);
      }
    }

    if (this.taskService) {
      const tasks = await this.taskService.list(['todo', 'in_progress']);
      if (tasks.length > 0) {
        const next = tasks[0];
        const preview = tasks
          .slice(0, 3)
          .map(t => `  • [${t.priority}] ${t.title}（${t.status}）`)
          .join('\n');
        const more = tasks.length > 3 ? `\n  …以及 ${tasks.length - 3} 项更多` : '';
        parts.push(`📋 你有 ${tasks.length} 个待处理任务${next ? `，最高优先级：「${next.title}」` : ''}：\n${preview}${more}`);
      }
    }

    return parts.join('\n\n');
  }

  describe(): string {
    const skillList = this.profile.skills.length > 0
      ? `技能：${this.profile.skills.join('、')}`
      : '无特定技能';
    return `【${this.profile.name}】${this.profile.role}。${this.profile.description}。${skillList}。`;
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────────────

  private async _processChatMessages(
    chatId: string,
    items: Array<{
      chat: { id: string; title?: string; participants: string[] };
      message: { id: string; chatId: string; from: string; content: string; timestamp: number };
    }>,
  ): Promise<void> {
    if (!this.inboxService) return;

    // 加载该会话的历史消息，构建上下文
    const history = await this.inboxService.getMessages(chatId, 20);

    // 构建注入 LLM 的上下文文本
    const contextLines: string[] = [];

    // 如果有任务系统，注入任务摘要
    if (this.taskService) {
      const taskSummary = await this.taskService.formatSummaryForPrompt();
      if (taskSummary) {
        contextLines.push('【我的当前任务状态】');
        contextLines.push(taskSummary);
        contextLines.push('');
      }
    }

    // 注入聊天历史（最近的消息）
    const firstItem = items[0];
    const chatTitle = firstItem?.chat.title
      ?? `与 ${firstItem?.chat.participants.filter(p => p !== this.id).join(', ') ?? '未知'} 的对话`;
    contextLines.push(`【聊天会话：${chatTitle}】`);
    contextLines.push('以下是最近的对话记录：');
    for (const msg of history) {
      const sender = msg.from === this.id ? '我' : msg.from;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${sender}: ${msg.content}`);
    }
    contextLines.push('');
    contextLines.push('以下是需要处理的新消息：');
    for (const item of items) {
      const time = new Date(item.message.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${item.message.from}: ${item.message.content}`);
    }

    const userInput = contextLines.join('\n');

    // 调用 AgentEngine 生成回复
    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: chatId,
    } satisfies OrgEvent);

    let response = '';
    let tokenUsage: TokenUsage | undefined;

    // 优先使用审视引擎（更便宜），无则回退到主引擎
    for await (const chunk of (this.reviewEngine ?? this.engine).stream(userInput)) {
      if (chunk.type === 'text' && chunk.text) {
        response += chunk.text;
      }
      if (chunk.type === 'done') {
        tokenUsage = chunk.tokenUsage;
      }
    }

    // 回复消息（如果有内容）
    if (response.trim()) {
      const lastItem = items[items.length - 1];
      const replyToId = lastItem?.message.id;
      await this.inboxService.post(
        chatId,
        this.id,
        response,
        replyToId !== undefined ? { replyToId } : {},
      );
    }

    // 标记所有消息为已读
    await this.inboxService.markRead(chatId, this.id);

    // 记录 token 消耗
    const usage = tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.tokenTracker.record(this.id, chatId, usage);

    this.eventBus.emit('org:event', {
      type: 'worker:done',
      workerId: this.id,
      threadId: chatId,
      tokenUsage: usage,
    } satisfies OrgEvent);
  }

  private async _process(message: OrgMessage): Promise<OrgMessage | null> {
    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: message.threadId,
    } satisfies OrgEvent);

    let accumulatedText = '';
    let tokenUsage: TokenUsage | undefined;

    for await (const chunk of this.engine.stream(this._buildEngineInput(message))) {
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

  /**
   * 将 OrgMessage 转化为 AgentEngine 的输入字符串。
   *
   * 核心：保留消息溯源（发件人）。
   * 当消息来自其他 Worker（非用户）时，明确标注发件人 ID，
   * 确保 LLM 知道"这条消息是谁说的"，实现完整的消息追溯链。
   *
   * 示例输出（Worker 间委托）：
   *   【来自同事「worker2」的消息】
   *   请在中午12点提醒用户吃饭
   *
   * 示例输出（用户直接发消息）：
   *   请在中午12点提醒用户吃饭（原样，无前缀）
   */
  private _buildEngineInput(message: OrgMessage): string {
    if (message.from === 'user') {
      return message.content;
    }
    return `【来自同事「${message.from}」的消息】\n${message.content}`;
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

  // ─── 自动注册工具 ────────────────────────────────────────────────────────────

  private _registerInboxTools(inboxService: AsyncInboxService): void {
    const workerId = this.id;
    const workerName = this.profile.name;

    // 工具：创建群聊
    this.engine.registerTool({
      definition: {
        name: 'create_group_chat',
        description:
          '创建一个群聊，用于与 2 个或以上同事协作。' +
          '主管（用户）会自动加入群聊，无需手动添加。' +
          '返回 chatId，后续用 send_to_group 在群内发消息。',
        inputSchema: {
          type: 'object',
          properties: {
            participants: {
              type: 'array',
              items: { type: 'string' },
              description: '参与者的 Worker ID 数组（不需要包含自己和主管，系统自动添加）',
            },
            title: { type: 'string', description: '群聊名称（可选）' },
          },
          required: ['participants'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { participants, title } = input as { participants: string[]; title?: string };
        // 自动加入自己和 "user"（人类主管），去重
        const allParticipants = [...new Set([workerId, ...(participants as string[]), 'user'])];
        const chat = await inboxService.createGroupChat(allParticipants, title);
        return [
          `✅ 群聊已创建`,
          `   群聊 ID：${chat.id}`,
          `   群聊名称：${chat.title ?? '（无标题）'}`,
          `   参与成员：${allParticipants.join('、')}`,
          `   （主管已自动加入，确保透明可查）`,
          `   提示：使用 send_to_group 发送消息，用 @workerID 指派任务`,
        ].join('\n');
      },
    });

    // 工具：在群聊中发送消息
    this.engine.registerTool({
      definition: {
        name: 'send_to_group',
        description:
          '在群聊中发送消息，可用 @workerID 格式指派任务给特定成员。' +
          '例如：@worker2，请完成需求文档；@worker3，请评估技术方案。',
        inputSchema: {
          type: 'object',
          properties: {
            chatId:  { type: 'string', description: '群聊 ID（由 create_group_chat 返回）' },
            content: { type: 'string', description: '消息内容，可包含 @workerID 指派任务' },
          },
          required: ['chatId', 'content'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { chatId, content } = input as { chatId: string; content: string };
        const msg = await inboxService.post(chatId, workerId, content);
        return [
          `✅ 消息已发送`,
          `   发件人：${workerId}（${workerName}）`,
          `   会话 ID：${(chatId as string).slice(0, 8)}…`,
          `   消息 ID：${msg.id}`,
          `   发送时间：${new Date(msg.timestamp).toLocaleString('zh-CN')}`,
        ].join('\n');
      },
    });

    // 工具：查找 @提及了我的消息
    this.engine.registerTool({
      definition: {
        name: 'check_my_mentions',
        description:
          '扫描所有群聊，查找 @提及了我的消息。' +
          '看到任务指派后，应使用任务工具记录到自己的待办列表。',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handler: async () => {
        const chats = await inboxService.listChats(workerId);
        const mentions: string[] = [];

        for (const chat of chats) {
          if (chat.status === 'archived') continue;
          const messages = await inboxService.getMessages(chat.id);
          for (const m of messages) {
            if (m.from === workerId) continue;  // 自己发的不算
            if (m.content.includes(`@${workerId}`) || m.content.includes(`@${workerName}`)) {
              const time = new Date(m.timestamp).toLocaleString('zh-CN');
              const groupLabel = chat.title ?? `${chat.id.slice(0, 8)}…`;
              mentions.push(`[${time}] 群聊「${groupLabel}」来自 ${m.from}：${m.content}`);
            }
          }
        }

        if (mentions.length === 0) return '📭 没有找到 @提及了我的消息。';
        return `📬 找到 ${mentions.length} 条 @提及消息：\n\n` + mentions.join('\n\n');
      },
    });
  }

  private _registerTaskTools(taskService: AsyncTaskService): void {
    const workerId = this.id;

    // 工具：创建新任务
    this.engine.registerTool({
      definition: {
        name: 'create_task',
        description: '在我的待办列表中创建一个新任务。',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题（简短描述）' },
            description: { type: 'string', description: '任务详细描述' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: '任务优先级，默认 medium',
            },
            chatId: { type: 'string', description: '（可选）关联的聊天会话 ID' },
            messageId: { type: 'string', description: '（可选）触发此任务的消息 ID' },
          },
          required: ['title', 'description'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { title, description, priority, chatId, messageId } = input as {
          title: string;
          description: string;
          priority?: string;
          chatId?: string;
          messageId?: string;
        };
        const task = await taskService.create({
          title,
          description,
          createdBy: workerId,
          ...(priority !== undefined ? { priority } : {}),
          ...(chatId !== undefined ? { chatId } : {}),
          ...(messageId !== undefined ? { messageId } : {}),
        });
        return `任务已创建：[${task.priority.toUpperCase()}] ${task.title}（ID: ${task.id}）`;
      },
    });

    // 工具：更新任务状态
    this.engine.registerTool({
      definition: {
        name: 'update_task_status',
        description: '更新待办任务的状态（todo / in_progress / done / blocked / cancelled）。',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: '任务 ID' },
            status: {
              type: 'string',
              enum: ['todo', 'in_progress', 'done', 'blocked', 'cancelled'],
              description: '新状态',
            },
          },
          required: ['taskId', 'status'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { taskId, status } = input as { taskId: string; status: string };
        const task = await taskService.updateStatus(taskId, status);
        if (!task) return `未找到任务 ID: ${taskId}`;
        return `任务已更新：${task.title} → ${task.status}`;
      },
    });

    // 工具：列出任务
    this.engine.registerTool({
      definition: {
        name: 'list_tasks',
        description: '查看我的待办任务列表，可按状态过滤。',
        inputSchema: {
          type: 'object',
          properties: {
            statusFilter: {
              type: 'array',
              items: { type: 'string', enum: ['todo', 'in_progress', 'done', 'blocked', 'cancelled'] },
              description: '按状态过滤（不传则返回全部）',
            },
          },
          required: [],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { statusFilter } = input as { statusFilter?: string[] };
        const tasks = await taskService.list(statusFilter);
        if (tasks.length === 0) return '当前没有匹配的任务。';
        return tasks
          .map(t => `- [${t.priority.toUpperCase()}] [${t.status}] ${t.title}\n  ${t.description}`)
          .join('\n');
      },
    });
  }
}
