import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type {
  OrgEvent,
  OrgMessage,
  Participant,
  Tool,
  TokenUsage,
  WorkerProfile,
  WorkerLifecycleState,
  EpisodicStore,
  Episode,
  Message,
  ToolCallChunk,
  ToolResultChunk,
} from '@bcc/foundation';
import { AgentEngine, type AgentEngineOptions } from '@bcc/agent-engine';
import { Mailbox } from './mailbox.js';
import { TokenTracker } from './token-tracker.js';
import { AuditLog } from './audit-log.js';
import { assertCapabilities } from './capability-registry.js';
import { LongTermMemory, buildConsolidationPrompt } from './long-term-memory.js';

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
    chat: { id: string; type: string; title?: string; participants: string[] };
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
   * 向已有群聊追加新成员（幂等：已在群内的成员自动跳过）。
   * 返回更新后的会话，若会话不存在则返回 null。
   */
  addMembersToGroup?(
    chatId: string,
    newParticipants: string[],
  ): Promise<{ id: string; participants: string[] } | null>;

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

  /** 获取会话的摘要（可选，Token 优化用） */
  getChatSummary?(chatId: string): Promise<string | null>;

  /** 更新会话摘要（可选，Token 优化用） */
  updateChatSummary?(chatId: string, summary: string): Promise<void>;
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
  /**
   * 审计日志实例（可选）。
   * 不提供时自动创建一个默认实例（写入 ~/.bcc/audit/{id}.jsonl）。
   * 多个 Worker 可以共享同一个 AuditLog 实例（日志按 workerId 分文件写入）。
   */
  auditLog?: AuditLog;

  // ── Capability 配套服务 ────────────────────────────────────────────────────

  /**
   * 情节记忆存储（可选）。
   * 配合 capabilities.memory.episodic 使用：
   * - 启动时注入最近 N 条情节摘要到 system prompt
   * - generateAndPersistEpisode() 被调用时将新摘要写入此存储
   */
  episodicStore?: EpisodicStore;

  /**
   * 情节摘要生成函数（可选）。
   * 签名与 EpisodeGenerator.generate() 一致，通过注入避免循环依赖。
   *
   * 典型用法：
   *   episodeGeneratorFn: (wid, sid, history) => generator.generate(wid, sid, history)
   */
  episodeGeneratorFn?: (
    workerId: string,
    sessionId: string,
    history: Message[],
  ) => Promise<Episode | null>;

  /**
   * 长期记忆提炼函数（可选）。
   * 调用时机：consolidateLongTermMemory() 被触发时（定时或手动）。
   *
   * @param workerId       Worker ID
   * @param existingMemory 当前 MEMORY.md 的内容（空字符串表示首次生成）
   * @param recentEpisodes 最近 N 条情节记忆
   * @returns 新的 MEMORY.md 内容；返回 null 时跳过写入
   */
  longTermConsolidatorFn?: (
    workerId: string,
    existingMemory: string,
    recentEpisodes: Episode[],
  ) => Promise<string | null>;

  /**
   * 同事 ID 提供函数（可选）。
   * 返回当前团队中所有有效 Worker ID 的列表（不含自身）。
   * 注入后，send_direct_message / create_group_chat 等工具会在执行前校验目标 ID，
   * 若 ID 不存在则立即返回错误提示，防止 LLM 向不存在的 Worker 发送消息。
   */
  peersProvider?: () => string[];

  /**
   * 会话 ID（用于情节记忆归档）。
   * 不提供时使用 `{profile.id}-{timestamp}` 作为默认值。
   */
  sessionId?: string;

  /**
   * 配置文件所在目录（用于解析 SOUL.md / USER.md 等相对路径）。
   * 不提供时使用当前工作目录 process.cwd()。
   */
  configDir?: string;
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

  // ── 生命周期状态机 ─────────────────────────────────────────────────────────
  private _state: WorkerLifecycleState = 'idle';
  /** 只读外部访问当前状态 */
  get state(): WorkerLifecycleState {
    return this._state;
  }

  // ── 审计日志 ───────────────────────────────────────────────────────────────
  readonly auditLog: AuditLog;

  // ── 记忆能力 ───────────────────────────────────────────────────────────────
  private _episodicStore: EpisodicStore | undefined;
  private _episodeGeneratorFn: ((workerId: string, sessionId: string, history: Message[]) => Promise<Episode | null>) | undefined;
  private _sessionId: string;
  private _longTermMemory: LongTermMemory | undefined;
  private _longTermConsolidatorFn: ((workerId: string, existingMemory: string, recentEpisodes: Episode[]) => Promise<string | null>) | undefined;

  private constructor(
    profile: WorkerProfile,
    engine: AgentEngine,
    tokenTracker: TokenTracker,
    eventBus: EventEmitter,
    inboxService?: AsyncInboxService,
    taskService?: AsyncTaskService,
    reviewEngine?: AgentEngine,
    auditLog?: AuditLog,
    episodicStore?: EpisodicStore,
    episodeGeneratorFn?: (workerId: string, sessionId: string, history: Message[]) => Promise<Episode | null>,
    sessionId?: string,
    longTermMemory?: LongTermMemory,
    longTermConsolidatorFn?: (workerId: string, existingMemory: string, recentEpisodes: Episode[]) => Promise<string | null>,
  ) {
    this.profile = profile;
    this.engine = engine;
    this.reviewEngine = reviewEngine;
    this.tokenTracker = tokenTracker;
    this.eventBus = eventBus;
    this.inboxService = inboxService;
    this.taskService = taskService;
    this.auditLog = auditLog ?? new AuditLog();
    this._episodicStore = episodicStore;
    this._episodeGeneratorFn = episodeGeneratorFn;
    this._sessionId = sessionId ?? `${profile.id}-${Date.now()}`;
    this._longTermMemory = longTermMemory;
    this._longTermConsolidatorFn = longTermConsolidatorFn;
    this.inbox = new Mailbox();

    // Mailbox 串行化处理：消息入队后依次调用 _process，丢弃返回值
    this.inbox.onMessage(async (msg) => {
      await this._process(msg);
    });
  }

  // ── 状态机操作（公开 API）─────────────────────────────────────────────────

  /**
   * 将 Worker 置为休眠状态（sleeping）。
   * 休眠中的 Worker 仍会接收消息，但放入队列直到 wake() 被调用。
   */
  async sleep(): Promise<void> {
    if (this._state !== 'idle') return;
    await this._setState('sleeping');
  }

  /**
   * 唤醒 Worker，从 sleeping 恢复到 idle。
   */
  async wake(): Promise<void> {
    if (this._state !== 'sleeping') return;
    await this._setState('idle');
  }

  /**
   * 暂停 Worker（手动挂起，等待恢复）。
   * 与 sleeping 的区别：sleeping 由心跳自动恢复，pause 需显式 resume。
   */
  async pause(): Promise<void> {
    if (this._state !== 'idle') return;
    await this._setState('blocked');
  }

  /**
   * 恢复 Worker，从 blocked 恢复到 idle。
   */
  async resume(): Promise<void> {
    if (this._state !== 'blocked') return;
    await this._setState('idle');
  }

  /**
   * 工厂方法：异步创建 Worker（等待 AgentEngine 初始化完成）。
   * 若注入了 inboxService / taskService，会自动注册对应的 LLM 工具。
   */
  static async create(options: WorkerOptions): Promise<Worker> {
    const { profile } = options;
    const capabilities = profile.capabilities;
    const configDir = options.configDir ?? process.cwd();

    // ── 1. 能力依赖校验（启动时断言，配置错误直接报错）──────────────────────
    if (capabilities) {
      assertCapabilities(
        profile.id,
        capabilities,
        profile.privilegeLevel ?? 'normal',
      );
    }

    // ── 2. 构建系统提示词（Soul → 原始 system → USER.md → 情节记忆）────────
    const engineOptions = { ...options.engineOptions };
    const systemParts: string[] = [];

    // 2a. Soul：SOUL.md 个性文件（最优先，定义 Worker 的核心身份）
    if (capabilities?.soul) {
      const soulConfig = typeof capabilities.soul === 'object' ? capabilities.soul : {};

      if (soulConfig.file) {
        const soulPath = resolve(configDir, soulConfig.file);
        const soulContent = await loadFile(soulPath);
        if (soulContent) systemParts.push(soulContent);
      }
    }

    // 2b. 调用方构建的系统提示词（身份 + 同事 + 通信指南）
    if (engineOptions.system) {
      systemParts.push(engineOptions.system);
    }

    // 2c. USER.md：用户/雇主背景信息
    if (capabilities?.soul && typeof capabilities.soul === 'object' && capabilities.soul.userContext) {
      const userPath = resolve(configDir, capabilities.soul.userContext);
      const userContent = await loadFile(userPath);
      if (userContent) systemParts.push(`## 关于用户\n\n${userContent}`);
    }

    // ── 2d. 长期记忆：加载 MEMORY.md（提炼的精华，比情节摘要更稳定）
    let longTermMemoryInstance: LongTermMemory | undefined;
    if (capabilities?.memory) {
      const memConfig = typeof capabilities.memory === 'object' ? capabilities.memory : {};
      if (memConfig.longTerm) {
        longTermMemoryInstance = new LongTermMemory(profile.id);
        const ltContent = await longTermMemoryInstance.load();
        if (ltContent.trim()) {
          systemParts.push(`## 长期记忆\n\n${ltContent.trim()}`);
        }
      }
    }

    // 2e. 情节记忆：启动时注入最近 N 条情节摘要
    if (capabilities?.memory && options.episodicStore) {
      const memConfig = typeof capabilities.memory === 'object' ? capabilities.memory : {};
      if (memConfig.episodic !== false) {
        const contextWindow = memConfig.contextWindow ?? 10;
        const episodes = await options.episodicStore.recent(profile.id, contextWindow);
        if (episodes.length > 0) {
          const episodeText = formatEpisodesForPrompt(episodes);
          systemParts.push(episodeText);
        }
      }
    }

    engineOptions.system = systemParts.filter(Boolean).join('\n\n---\n\n') || undefined;

    // ── 3. 初始化引擎 ─────────────────────────────────────────────────────────
    const engine = await AgentEngine.create(engineOptions);
    const reviewEngine = options.reviewEngineOptions
      ? await AgentEngine.create(options.reviewEngineOptions)
      : undefined;
    const tokenTracker = options.tokenTracker ?? new TokenTracker();
    const eventBus = options.eventBus ?? new EventEmitter();
    const auditLog = options.auditLog ?? new AuditLog();

    const worker = new Worker(
      profile,
      engine,
      tokenTracker,
      eventBus,
      options.inboxService,
      options.taskService,
      reviewEngine,
      auditLog,
      options.episodicStore,
      options.episodeGeneratorFn,
      options.sessionId,
      longTermMemoryInstance,
      options.longTermConsolidatorFn,
    );

    // 自动注册 inbox / task 工具
    if (options.inboxService) {
      const hasCommunicateSkill = profile.skills?.includes('communicate') ?? false;
      worker._registerInboxTools(options.inboxService, hasCommunicateSkill, options.peersProvider);
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

    void this.auditLog.recordMessageReceived(
      this.id, message.id, message.from, message.threadId,
    );

    return this._process(message);
  }

  /**
   * 流式接收：产生文字片段事件流，适合实时展示 Worker 的思考过程。
   */
  async *receiveStream(
    message: OrgMessage,
  ): AsyncIterable<
    | { type: 'chunk'; text: string }
    | ToolCallChunk
    | ToolResultChunk
    | { type: 'done'; reply: OrgMessage }
  > {
    await this._setState('processing');
    void this.auditLog.recordMessageReceived(
      this.id, message.id, message.from, message.threadId,
    );

    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: message.threadId,
    } satisfies OrgEvent);

    let accumulatedText = '';
    let tokenUsage: TokenUsage | undefined;

    try {
      for await (const chunk of this.engine.stream(this._buildEngineInput(message))) {
        if (chunk.type === 'text' && chunk.text) {
          accumulatedText += chunk.text;
          yield { type: 'chunk', text: chunk.text };
        } else if (chunk.type === 'tool_call') {
          // 透传工具调用事件，供 HTTP 流式 UI 实时展示
          yield chunk as ToolCallChunk;
        } else if (chunk.type === 'tool_result') {
          // 透传工具结果事件，供 HTTP 流式 UI 实时展示
          yield chunk as ToolResultChunk;
        } else if (chunk.type === 'done') {
          tokenUsage = chunk.tokenUsage;
        }
      }
    } finally {
      await this._setState('idle');
    }

    const reply = this._buildReply(message, accumulatedText, tokenUsage);
    this._recordAndEmit(message.threadId, tokenUsage, reply);
    void this.auditLog.recordMessageSent(
      this.id, reply.id, String(reply.to), reply.threadId, undefined, tokenUsage,
    );
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
    // sleeping / blocked 状态下跳过（不主动处理，等状态恢复后下次心跳再试）
    if (this._state === 'sleeping' || this._state === 'blocked') return;

    const pending = await this.inboxService.getPendingMessages(this.id);
    const routineSteps = this._getRoutineSteps();

    if (pending.length === 0) {
      this.eventBus.emit('org:event', {
        type: 'worker:inbox:checked',
        workerId: this.id,
        pendingCount: 0,
      } satisfies OrgEvent);
      void this.auditLog.recordInboxChecked(this.id, 0, []);

      // 即使没有未读消息，若配置了 planDay 则执行晨检流程
      if (routineSteps.includes('planDay')) {
        await this._runMorningRoutine([], routineSteps);
      }
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

    await this._setState('processing');
    try {
      // 有未读消息时：先处理消息，若 planDay 则在末尾补一次规划
      for (const [chatId, items] of byChat) {
        await this._processChatMessages(chatId, items);
      }
      if (routineSteps.includes('planDay')) {
        await this._runMorningRoutine(pending, routineSteps);
      }
    } finally {
      await this._setState('idle');
    }

    void this.auditLog.recordInboxChecked(
      this.id,
      pending.length,
      [...byChat.keys()],
    );
  }

  // ─── 工具注册（运行时追加技能）──────────────────────────────────────────────

  /** 注册工具（运行时追加技能） */
  registerTool(tool: Tool): void {
    this.engine.registerTool(tool);
  }

  // ── 记忆管理（公开 API）─────────────────────────────────────────────────────

  /**
   * 生成本次对话的情节记忆摘要并持久化到 EpisodicStore。
   *
   * 调用时机：一次完整的用户交互结束后（CLI 退出、HTTP 会话关闭等）。
   * 需要同时配置 episodicStore 和 episodeGeneratorFn 才会生效。
   *
   * @returns 生成的 Episode，若配置缺失或历史太短则返回 null
   */
  async generateAndPersistEpisode(): Promise<Episode | null> {
    if (!this._episodicStore || !this._episodeGeneratorFn) return null;

    const history = this.engine.getHistory();
    const episode = await this._episodeGeneratorFn(
      this.profile.id,
      this._sessionId,
      history,
    );

    if (episode) {
      await this._episodicStore.append(episode);
    }
    return episode;
  }

  /**
   * 提炼长期记忆：从 EpisodicStore 中读取最近情节摘要，调用 LLM 生成/更新 MEMORY.md。
   *
   * 调用时机：
   *   - 每日定时（由 WorkerScheduler 或外部 Cron 触发）
   *   - 手动调用（调试 / 强制更新）
   *
   * 需要同时满足以下条件才会生效：
   *   - capabilities.memory.longTerm === true
   *   - longTermConsolidatorFn 已注入
   *   - episodicStore 已注入
   *
   * @returns 新的 MEMORY.md 内容；条件不满足或生成失败时返回 null
   */
  async consolidateLongTermMemory(): Promise<string | null> {
    if (!this._longTermMemory || !this._longTermConsolidatorFn || !this._episodicStore) {
      return null;
    }

    // 读取最近 30 条情节记忆（提炼用，比启动注入的窗口更大）
    const episodes = await this._episodicStore.recent(this.profile.id, 30);
    if (episodes.length === 0) return null;

    const existingMemory = await this._longTermMemory.load();
    const newContent = await this._longTermConsolidatorFn(
      this.profile.id,
      existingMemory,
      episodes,
    );

    if (newContent) {
      await this._longTermMemory.save(newContent);
    }
    return newContent;
  }

  // ─── Morning Routine 内部方法 ─────────────────────────────────────────────

  /**
   * 获取 proactivity.routine 配置中启用的步骤列表。
   * 若未配置主动性能力则返回空数组。
   */
  private _getRoutineSteps(): string[] {
    const pro = this.profile.capabilities?.proactivity;
    if (!pro) return [];
    if (pro === true) return [];
    return pro.routine ?? [];
  }

  /**
   * 执行晨检流程（Morning Routine）。
   *
   * 根据 routine 步骤配置，构建综合上下文并交由 LLM 自主规划当日工作。
   * LLM 可以通过已注册工具（call_worker、create_task、send_direct_message 等）
   * 主动推进工作，无需等待外部触发。
   *
   * @param pendingMessages  当前未读消息（已知但未处理，作为上下文参考）
   * @param steps            routine 步骤列表
   */
  private async _runMorningRoutine(
    pendingMessages: Array<{ chat: { id: string }; message: { from: string; content: string } }>,
    steps: string[],
  ): Promise<void> {
    const engine = this.reviewEngine ?? this.engine;
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const contextParts: string[] = [
      `## 晨检报告 — ${now}`,
      `你是「${this.profile.name}」，现在开始每日晨检流程。`,
    ];

    // checkInbox：汇报未读消息数量
    if (steps.includes('checkInbox') || steps.includes('planDay')) {
      if (pendingMessages.length > 0) {
        const preview = pendingMessages
          .slice(0, 5)
          .map(p => `  • ${p.message.from}：${p.message.content.slice(0, 60)}`)
          .join('\n');
        contextParts.push(`### 已有未读消息（${pendingMessages.length} 条）\n${preview}`);
      } else {
        contextParts.push('### 收件箱：无新消息');
      }
    }

    // reviewTasks：注入任务摘要
    if ((steps.includes('reviewTasks') || steps.includes('planDay')) && this.taskService) {
      const taskSummary = await this.taskService.formatSummaryForPrompt();
      if (taskSummary) {
        contextParts.push(`### 任务状态\n${taskSummary}`);
      } else {
        contextParts.push('### 任务状态：无待处理任务');
      }
    }

    // planDay：请 LLM 规划当日工作
    if (steps.includes('planDay')) {
      contextParts.push(
        '### 请规划今天的工作重点',
        '基于以上信息，请：\n' +
        '1. 列出今天最重要的 2-3 个工作重点\n' +
        '2. 如有需要，使用工具创建任务、委托给同事、或发送通知\n' +
        '3. 如一切正常且无需操作，回复「今日无新安排」',
      );
    }

    const prompt = contextParts.join('\n\n');
    let tokenUsage: TokenUsage | undefined;

    try {
      for await (const chunk of engine.stream(prompt)) {
        if (chunk.type === 'done') {
          tokenUsage = chunk.tokenUsage;
        }
      }
    } catch {
      // 晨检失败静默处理，不影响正常消息处理
    }

    if (tokenUsage) {
      this.tokenTracker.record(this.id, 'morning-routine', tokenUsage);
    }
  }

  // ─── 状态机内部方法 ──────────────────────────────────────────────────────────

  /**
   * 内部状态切换：更新 _state、发布事件、写审计日志。
   * 对外用 sleep/wake/pause/resume；receive/processInbox 内部直接调用此方法。
   */
  private async _setState(newState: WorkerLifecycleState): Promise<void> {
    const previousState = this._state;
    if (previousState === newState) return;
    this._state = newState;
    this.eventBus.emit('org:event', {
      type: 'worker:state:changed',
      workerId: this.id,
      previousState,
      newState,
      timestamp: Date.now(),
    } satisfies OrgEvent);
    void this.auditLog.recordStateChange(this.id, previousState, newState);
  }

  // ─── 辅助方法 ────────────────────────────────────────────────────────────────

  /**
   * 获取底层 AgentEngine 的完整对话历史（LLM 协议格式）。
   * 包含从持久化存储恢复的历史，供 WorkerSession.getHistory() 和情节摘要使用。
   */
  getHistory() {
    return this.engine.getHistory();
  }

  /** 清空 Worker 引擎的对话历史（用于会话隔离）。 */
  clearHistory(): void {
    this.engine.clearHistory();
  }

  /** 用外部消息列表替换引擎历史（多 chat 会话上下文切换用）。 */
  loadHistory(messages: Message[]): void {
    this.engine.loadHistory(messages);
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
      chat: { id: string; type: string; title?: string; participants: string[] };
      message: { id: string; chatId: string; from: string; content: string; timestamp: number };
    }>,
  ): Promise<void> {
    if (!this.inboxService) return;

    // ── Task Briefing Pattern（Token 优化）──────────────────────────────────
    // 优先使用会话摘要 + 最近 5 条消息，而非完整历史（原来 20 条）。
    // 有摘要时：token 减少约 60-70%；无摘要时：加载最近 8 条（保守回退）。

    const existingSummary = this.inboxService.getChatSummary
      ? await this.inboxService.getChatSummary(chatId)
      : null;

    // 有摘要时只加载最近 5 条（摘要已覆盖更早的上下文）
    // 无摘要时加载最近 10 条（首次交互，无历史可压缩）
    const historyLimit = existingSummary ? 5 : 10;
    const history = await this.inboxService.getMessages(chatId, historyLimit);

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

    // 注入聊天历史（摘要 + 最近消息）
    const firstItem = items[0];
    const chatTitle = firstItem?.chat.title
      ?? `与 ${firstItem?.chat.participants.filter(p => p !== this.id).join(', ') ?? '未知'} 的对话`;
    const chatType = firstItem?.chat.type ?? 'direct';
    const isGroupChat = chatType === 'group';
    contextLines.push(`【聊天会话：${chatTitle}】`);
    contextLines.push(`会话 ID：${chatId}（${isGroupChat ? '群聊' : '私聊'}）`);

    // 注入摘要（若有）
    if (existingSummary) {
      contextLines.push('以下是本会话的历史摘要：');
      contextLines.push(existingSummary);
      contextLines.push('');
      contextLines.push(`以下是最近 ${history.length} 条对话记录：`);
    } else {
      contextLines.push('以下是最近的对话记录：');
    }

    for (const msg of history) {
      const sender = msg.from === this.id ? `我（${this.id}）` : msg.from;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${sender}: ${msg.content}`);
    }
    contextLines.push('');
    contextLines.push('以下是需要处理的新消息：');
    for (const item of items) {
      const time = new Date(item.message.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${item.message.from}: ${item.message.content}`);
    }
    contextLines.push('');

    // 人称转换提示：帮助 LLM 在转发/委托时正确替换人称词
    const allSenders = [...new Set(items.map(i => i.message.from).filter(f => f !== this.id))];
    if (allSenders.length > 0) {
      const senderDescs = allSenders.map(s =>
        s === 'user'
          ? '"user"（用户/主管）：其说的"我"= 用户本人，不是你'
          : `"${s}"：其说的"我"= ${s} 本人`,
      );
      contextLines.push(
        `【人称说明】各发送方说的"我"指其自身，不是你：`,
        ...senderDescs.map(d => `  - ${d}`),
        `转发或委托时，必须将"我"替换为具体人名，绝不能替换成你自己的 ID。`,
      );
      contextLines.push('');
    }

    // 回复规范：引导 LLM 判断如何处理消息
    contextLines.push(
      '【处理规范】根据消息类型决定如何响应：',
      '',
      '▶ 收到来自同事的私信（1:1 私聊）中的新任务或委托 → 必须按以下顺序执行：',
      '  1. 【先在此私信中回复】用 send_direct_message 回复发送方，告知已收到并会处理',
      '     （在当前私信回复，不要在群聊回复，以保持沟通上下文连贯）',
      '  2. 执行任务（写代码、调用工具、收集信息等）',
      '  3. 如果任务需要其他同事协作：',
      '     a. 用 create_group_chat 创建包含相关同事的群聊（会话 ID 见上方"会话 ID"）',
      '     b. 用 send_to_group 在群聊中分配子任务（@workerID 指派）',
      '  4. 任务完成后，通过 notify_user 将最终结果发给用户',
      '  5. 输出 [SKIP] 结束本轮处理',
      '',
      '▶ 收到来自用户的任务或委托 → 必须执行以下完整流程：',
      '  1. 先回复确认收到：告知发送方你已收到并会处理',
      '  2. 使用工具执行任务（写代码、创建提醒、发消息等）',
      '  3. 如果任务需要其他同事协作：',
      '     - 当前是群聊（会话 ID 见上方）→ 优先用 add_members_to_group 将新同事加入本群，',
      '       再用 send_to_group 在本群分配子任务（@workerID 指派）',
      '     - 当前是私聊 → 用 create_group_chat 新建群（把相关同事都拉进来）',
      '  4. 任务完成后，通过 notify_user 将结果发给用户（如果最终受益方是用户）',
      '  5. 完成第4步后，输出 [SKIP] 作为文本回复（绝不在群聊中再追加描述性文字）',
      '',
      '▶ 收到同事的任务完成通知（同事完成了你委托给他的任务）→ 执行以下流程：',
      '  1. 调用 notify_user 将结果转交给用户',
      '  2. 必须输出 [SKIP] 作为文本回复，不向群聊追加任何文字',
      '  ⚠️ 理由：在群聊发文字会触发对方再次回复，形成无限循环',
      '',
      '▶ 以下情况直接输出 [SKIP]（不回复、不调用工具）：',
      '  · 对方只是简单确认"好的""收到""明白了"且无任何新请求',
      '  · 对方仅汇报任务进度状态，无需你作出决策或提供信息',
      '',
      '⚠️ 输出 [SKIP] 时请勿添加其他文字，勿调用任何工具。',
      '⚠️ 收到新任务时绝不能 [SKIP]，必须确认 + 执行 + 用工具汇报（完成后输出 [SKIP]）。',
      '⚠️ 收到同事私信任务时：必须先在私信中回复，再创建群聊（如需协作），顺序不可颠倒。',
    );

    const userInput = contextLines.join('\n');

    // 调用 AgentEngine 生成回复
    this.eventBus.emit('org:event', {
      type: 'worker:thinking',
      workerId: this.id,
      threadId: chatId,
    } satisfies OrgEvent);

    let response = '';
    let tokenUsage: TokenUsage | undefined;

    // 必须使用主引擎：inbox 消息处理需要完整的工具能力（写代码、发消息、创建任务等）
    // reviewEngine 未注册工具，只能生成纯文本，无法执行任务，不能用于 inbox 处理
    for await (const chunk of this.engine.stream(userInput)) {
      if (chunk.type === 'text' && chunk.text) {
        response += chunk.text;
      }
      if (chunk.type === 'done') {
        tokenUsage = chunk.tokenUsage;
      }
    }

    // 回复消息（如果有内容，且不是 [SKIP] 信号）
    const isSkip = /^\s*\[SKIP\]/i.test(response);
    if (!isSkip && response.trim()) {
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

    // ── 异步更新会话摘要（Token 优化）──────────────────────────────────────
    // 每处理 10 条以上消息后触发摘要更新（异步，不阻塞当前响应）
    if (this.inboxService.updateChatSummary) {
      const totalMessages = history.length + items.length;
      if (totalMessages >= 10 || existingSummary) {
        void this._updateChatSummary(chatId, history, items, existingSummary);
      }
    }

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

  /**
   * 异步更新 Worker 间会话摘要（Task Briefing Pattern）。
   *
   * 调用 LLM 对最近一批消息生成/更新摘要，存入 ChatStore。
   * 后续 processInbox() 加载上下文时优先使用摘要 + 少量近期消息，
   * 大幅减少 Worker 间通信的 token 消耗（节省 60-70%）。
   *
   * 此方法在消息处理完成后异步触发，不阻塞当前响应。
   */
  private async _updateChatSummary(
    chatId: string,
    history: Array<{ from: string; content: string; timestamp: number }>,
    newItems: Array<{ message: { from: string; content: string; timestamp: number } }>,
    existingSummary: string | null,
  ): Promise<void> {
    if (!this.inboxService?.updateChatSummary) return;

    try {
      // 构建待摘要的对话文本
      const allMessages = [
        ...history,
        ...newItems.map(i => i.message),
      ];

      const conversationText = allMessages
        .slice(-20)  // 最多取最近 20 条
        .map(m => {
          const sender = m.from === this.id ? `我（${this.id}）` : m.from;
          return `${sender}: ${m.content.slice(0, 300)}`;
        })
        .join('\n');

      const promptParts: string[] = [];
      if (existingSummary) {
        promptParts.push(`现有摘要：\n${existingSummary}\n\n请结合以下新消息更新摘要：`);
      } else {
        promptParts.push('请为以下 Worker 间对话生成简洁摘要：');
      }
      promptParts.push(conversationText);
      promptParts.push('\n摘要格式（简洁，保留关键信息）：\n- 当前任务/目标：\n- 已完成事项：\n- 待处理事项：\n- 关键决策：');

      const summaryChunks: string[] = [];
      const engine = this.reviewEngine ?? this.engine;
      for await (const chunk of engine.stream(promptParts.join('\n\n'))) {
        if (chunk.type === 'text' && chunk.text) {
          summaryChunks.push(chunk.text);
        }
      }

      const summary = summaryChunks.join('').trim();
      if (summary) {
        await this.inboxService.updateChatSummary(chatId, summary);
      }
    } catch {
      // 摘要生成失败静默忽略，不影响主流程
    }
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
   * 核心：保留消息溯源（发件人）并提示人称转换规则。
   * 当消息来自其他 Worker（非用户）时，明确标注发件人 ID，
   * 并提醒 LLM：转发或委托时须将"我"等人称替换为具体的人名/ID。
   */
  private _buildEngineInput(message: OrgMessage): string {
    if (message.from === 'user') {
      return message.content;
    }
    return [
      `【来自同事「${message.from}」的消息】`,
      `（注意：消息中的"我"指「${message.from}」，若你需要转发或委托给他人，`,
      `请将人称词替换为具体的 Worker ID，不要原样照搬"我""你"等代词）`,
      '',
      message.content,
    ].join('\n');
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

  /**
   * 注册收件箱相关工具。
   *
   * 权限分层：
   * - 所有 Worker（hasCommunicateSkill = false）：只注册 `notify_user`，
   *   可主动通知用户（任务完成汇报等），但**不能主动向其他 Worker 发起沟通**。
   * - 具备 `communicate` 技能的 Worker（hasCommunicateSkill = true）：
   *   额外注册 `create_group_chat`、`send_to_group`、`send_direct_message`、
   *   `check_my_mentions`，可发起跨 Worker 协作。
   *
   * 注意：无论是否具备 communicate 技能，`processInbox()` 都会处理收件箱消息
   * 并发送文字回复——工具权限不影响"回复"能力，只影响"主动发起"能力。
   */
  private _registerInboxTools(inboxService: AsyncInboxService, hasCommunicateSkill = false, peersProvider?: () => string[]): void {
    const workerId = this.id;
    const workerName = this.profile.name;

    // ── notify_user：所有 Worker 都有，用于主动通知用户 ────────────────────────
    this.engine.registerTool({
      definition: {
        name: 'notify_user',
        description:
          '向用户（主管）发送主动通知。适用场景：任务完成后汇报结果、遇到阻碍需要用户决策。' +
          '注意：此工具只能发给用户，不能发给其他 Worker。',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '通知内容' },
          },
          required: ['content'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { content } = input as { content: string };
        const chat = await inboxService.openDirectChat(workerId, 'user');
        const msg = await inboxService.post(chat.id, workerId, content);
        return [
          `✅ 已通知用户`,
          `   消息 ID：${msg.id}`,
          `   发送时间：${new Date(msg.timestamp).toLocaleString('zh-CN')}`,
        ].join('\n');
      },
    });

    // ── 以下工具仅具备 communicate 技能的 Worker 才注册 ────────────────────────
    if (!hasCommunicateSkill) return;

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
        // 校验所有参与者 ID 是否有效
        if (peersProvider) {
          const validIds = peersProvider();
          const invalidIds = (participants as string[]).filter(p => p !== 'user' && !validIds.includes(p));
          if (invalidIds.length > 0) {
            return [
              `❌ 创建失败：以下 Worker ID 在当前团队中不存在：${invalidIds.join('、')}`,
              `   有效的同事 ID：${validIds.length > 0 ? validIds.join('、') : '（暂无同事）'}`,
              `   请根据上方同事名录核实 ID 后重试。`,
            ].join('\n');
          }
        }
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

    // 工具：向已有群聊追加成员（在协作任务中扩展群而非新建群）
    if (inboxService.addMembersToGroup) {
      const _addMembersImpl = inboxService.addMembersToGroup.bind(inboxService);
      this.engine.registerTool({
        definition: {
          name: 'add_members_to_group',
          description:
            '将新同事加入已有群聊（不新建群）。' +
            '当任务在某个群聊中展开、你需要拉更多同事协作时，' +
            '用此工具扩展该群，而非另建新群——这样所有协作过程都在同一个群里清晰可查。' +
            '已在群内的成员会自动跳过（幂等）。',
          inputSchema: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: '要追加成员的群聊 ID' },
              newMembers: {
                type: 'array',
                items: { type: 'string' },
                description: '要加入的 Worker ID 数组（不需要包含自己或 user，系统自动过滤重复）',
              },
            },
            required: ['chatId', 'newMembers'],
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const { chatId: targetChatId, newMembers } = input as { chatId: string; newMembers: string[] };
          // 校验所有新成员 ID 是否有效
          if (peersProvider) {
            const validIds = peersProvider();
            const invalidIds = (newMembers as string[]).filter(p => p !== 'user' && !validIds.includes(p));
            if (invalidIds.length > 0) {
              return [
                `❌ 操作失败：以下 Worker ID 在当前团队中不存在：${invalidIds.join('、')}`,
                `   有效的同事 ID：${validIds.length > 0 ? validIds.join('、') : '（暂无同事）'}`,
              ].join('\n');
            }
          }
          const updated = await _addMembersImpl(targetChatId, newMembers as string[]);
          if (!updated) {
            return `❌ 操作失败：群聊 ID "${targetChatId}" 不存在，请确认 chatId 是否正确。`;
          }
          return [
            `✅ 成员已添加`,
            `   群聊 ID：${targetChatId}`,
            `   当前成员：${updated.participants.join('、')}`,
            `   提示：新成员已加入，可继续用 send_to_group 发消息并 @新成员 分配任务`,
          ].join('\n');
        },
      });
    }

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

    // 工具：发送私信（给其他 Worker 或用户）
    this.engine.registerTool({
      definition: {
        name: 'send_direct_message',
        description:
          '向指定 Worker 发送私信。会自动创建或复用已有的 1 对 1 会话。' +
          '用途：委托任务给特定 Worker、私下协商、链式委托中通知上级完成情况。' +
          '如只是通知用户（主管），优先使用 notify_user 工具更简洁。',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: '接收方的 Worker ID（不是 "user"，通知用户请用 notify_user）',
            },
            content: { type: 'string', description: '消息内容' },
          },
          required: ['to', 'content'],
        },
      },
      handler: async (input: Record<string, unknown>) => {
        const { to, content } = input as { to: string; content: string };
        // 校验接收方是否是有效的 Worker ID
        if (peersProvider) {
          const validIds = peersProvider();
          if (!validIds.includes(to)) {
            return [
              `❌ 发送失败：Worker "${to}" 在当前团队中不存在。`,
              `   有效的同事 ID：${validIds.length > 0 ? validIds.join('、') : '（暂无同事）'}`,
              `   请根据上方同事名录核实目标 ID 后重试。`,
            ].join('\n');
          }
        }
        const chat = await inboxService.openDirectChat(workerId, to);
        const msg = await inboxService.post(chat.id, workerId, content);
        return [
          `✅ 私信已发送`,
          `   收件人：${to}`,
          `   会话 ID：${chat.id.slice(0, 8)}…`,
          `   消息 ID：${msg.id}`,
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

// ─── 模块级工具函数 ───────────────────────────────────────────────────────────

/**
 * 安全读取文件内容，文件不存在时返回 null（不抛错）。
 */
async function loadFile(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 将情节记忆列表格式化为可注入 system prompt 的文本块。
 * 最新的记忆排在最后（靠近对话上下文，LLM 更容易关注）。
 */
function formatEpisodesForPrompt(episodes: Episode[]): string {
  if (episodes.length === 0) return '';

  const lines = ['## 过往记忆（最近 ' + episodes.length + ' 条）'];
  // episodes 来自 recent()，是倒序返回的，这里反转为时间升序
  const ordered = [...episodes].reverse();

  for (const ep of ordered) {
    const date = new Date(ep.createdAt).toLocaleDateString('zh-CN');
    lines.push(`\n### ${date}（${ep.turnCount} 轮对话）`);
    lines.push(ep.summary);
    if (ep.keyPoints.length > 0) {
      lines.push('关键结论：');
      for (const point of ep.keyPoints) {
        lines.push(`- ${point}`);
      }
    }
  }

  return lines.join('\n');
}
