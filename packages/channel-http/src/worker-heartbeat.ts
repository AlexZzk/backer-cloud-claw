import type { AgentInterface } from '@bcc/foundation';
import type { ChatStore } from '@bcc/messaging';

// ─── 心跳事件类型 ─────────────────────────────────────────────────────────────

/**
 * HeartbeatEvent：心跳处理器向外广播的事件。
 * HttpServer 订阅这些事件，通过 GET /api/events SSE 流推送给前端。
 *
 * 对标 OpenClaw 的 heartbeat 机制：
 * - tick         → 一次心跳开始，告知外界"Worker 正在检查"
 * - processed    → Worker 处理了一条未读会话（可能回复，可能静默）
 * - idle         → Worker 本次心跳无事可做（对标 HEARTBEAT_OK）
 * - error        → 本次心跳出现异常
 */
export type HeartbeatEvent =
  | { type: 'heartbeat:tick';      workerId: string; pendingCount: number }
  | { type: 'heartbeat:processed'; workerId: string; chatId: string; replySent: boolean }
  | { type: 'heartbeat:idle';      workerId: string }
  | { type: 'heartbeat:error';     workerId: string; error: string };

// ─── WorkerHeartbeatManager ───────────────────────────────────────────────────

/**
 * WorkerHeartbeatManager：Worker 定期心跳调度器（HTTP 服务层）。
 *
 * ## 设计理念（对标 OpenClaw heartbeat）
 *
 * OpenClaw 的 heartbeat 机制：
 * - 后台 daemon 定期唤醒 Agent，注入 HEARTBEAT.md 检查清单
 * - Agent 决定是否行动；无事可做时回复 HEARTBEAT_OK，Gateway 静默丢弃
 * - 有事可做时正常回复，触发后续消息流
 *
 * BCC 的实现：
 * - 定期轮询每个 Worker 的 ChatStore，获取未读消息
 * - 无未读消息 → HEARTBEAT_OK，不调用 LLM（零 Token 消耗）
 * - 有未读消息 → 构建上下文，驱动 AgentEngine 生成回复，回写 ChatStore
 * - Worker 回复 "HEARTBEAT_OK" 或内容过短 → 静默确认，不写回
 * - 所有操作通过回调通知外部（供 SSE /api/events 推送前端）
 *
 * ## 架构说明
 *
 * HttpServer 已持有 chatStore 和 workerAgents（AgentEngine 实例），
 * WorkerHeartbeatManager 通过回调复用这些资源，不引入额外依赖。
 * 使用回调而非 EventEmitter，与 WorkerScheduler 的设计风格保持一致。
 */
export class WorkerHeartbeatManager {
  /** 每个 Worker 的定时器 */
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  /** 正在处理中的 Worker（防止并发同一个 Worker 的两轮心跳） */
  private processing = new Set<string>();
  /** 心跳事件监听器列表 */
  private listeners: Array<(event: HeartbeatEvent) => void> = [];

  constructor(
    private readonly chatStore: ChatStore,
    /** 获取指定 Worker 的 AgentInterface（按需懒加载） */
    private readonly getAgent: (workerId: string) => AgentInterface | undefined,
    /** 获取 Worker 的显示名称（用于构建上下文 prompt） */
    private readonly getWorkerName: (workerId: string) => string,
    /** 默认心跳间隔（毫秒），默认 30 秒 */
    private readonly defaultIntervalMs = 30_000,
  ) {}

  /** 注册心跳事件监听器 */
  on(listener: (event: HeartbeatEvent) => void): void {
    this.listeners.push(listener);
  }

  /** 移除心跳事件监听器 */
  off(listener: (event: HeartbeatEvent) => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  private emit(event: HeartbeatEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* 监听器异常不能影响心跳 */ }
    }
  }

  // ─── 调度控制 ────────────────────────────────────────────────────────────────

  /** 启动某个 Worker 的定时心跳 */
  start(workerId: string, intervalMs?: number): void {
    this.stop(workerId);
    const interval = intervalMs ?? this.defaultIntervalMs;
    const timer = setInterval(() => {
      void this._runHeartbeat(workerId);
    }, interval);
    // 允许进程在只剩定时器时退出（不阻塞 Node.js event loop）
    if (timer.unref) timer.unref();
    this.timers.set(workerId, timer);
  }

  /** 启动所有 Worker 的定时心跳 */
  startAll(workerIds: string[], intervalMs?: number): void {
    for (const id of workerIds) {
      this.start(id, intervalMs);
    }
  }

  /** 停止某个 Worker 的定时心跳 */
  stop(workerId: string): void {
    const timer = this.timers.get(workerId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(workerId);
    }
  }

  /** 停止所有心跳 */
  stopAll(): void {
    for (const id of [...this.timers.keys()]) {
      this.stop(id);
    }
  }

  /** 立即手动触发某个 Worker 的一次心跳（不受间隔限制） */
  async triggerHeartbeat(workerId: string): Promise<void> {
    await this._runHeartbeat(workerId);
  }

  /** 检查某个 Worker 的心跳是否正在运行 */
  isRunning(workerId: string): boolean {
    return this.timers.has(workerId);
  }

  /** 获取所有正在运行心跳的 Worker ID */
  listRunning(): string[] {
    return [...this.timers.keys()];
  }

  // ─── 心跳核心逻辑 ─────────────────────────────────────────────────────────────

  private async _runHeartbeat(workerId: string): Promise<void> {
    // 防止并发：上一轮心跳还没处理完时跳过本次
    if (this.processing.has(workerId)) return;
    this.processing.add(workerId);

    try {
      // Step 1：获取该 Worker 的所有未读消息
      const pending = await this.chatStore.getAllUnread(workerId);

      this.emit({
        type: 'heartbeat:tick',
        workerId,
        pendingCount: pending.length,
      } satisfies HeartbeatEvent);

      // Step 2：无未读消息 → HEARTBEAT_OK 静默跳过
      if (pending.length === 0) {
        this.emit({
          type: 'heartbeat:idle',
          workerId,
        } satisfies HeartbeatEvent);
        return;
      }

      // Step 3：获取该 Worker 的 AgentEngine
      const agent = this.getAgent(workerId);
      if (!agent) return;

      // Step 4：按 chatId 分组，批量处理同一会话的多条消息
      const byChat = new Map<string, typeof pending>();
      for (const item of pending) {
        const group = byChat.get(item.message.chatId) ?? [];
        group.push(item);
        byChat.set(item.message.chatId, group);
      }

      for (const [chatId, items] of byChat) {
        await this._processChatMessages(workerId, agent, chatId, items);
      }
    } catch (err) {
      this.emit({
        type: 'heartbeat:error',
        workerId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies HeartbeatEvent);
    } finally {
      this.processing.delete(workerId);
    }
  }

  /**
   * 处理单个会话中的未读消息。
   *
   * 工作流程（对标 OpenClaw 的 HEARTBEAT.md 驱动）：
   * 1. 加载会话历史（最近 20 条，提供上下文）
   * 2. 构建"心跳唤醒" prompt：告知 Worker 当前时间、会话、待处理消息
   * 3. 调用 AgentEngine 生成回复
   * 4. 若 Worker 回复 HEARTBEAT_OK（无需行动）→ 标记已读，不写回
   * 5. 若 Worker 有实际回复 → 写回 ChatStore，标记已读
   */
  private async _processChatMessages(
    workerId: string,
    agent: AgentInterface,
    chatId: string,
    items: Array<{ chat: import('@bcc/foundation').Chat; message: import('@bcc/foundation').ChatMessage }>,
  ): Promise<void> {
    // 加载该会话的历史消息（提供上下文）
    const history = await this.chatStore.getMessages(chatId, 20);
    const chat = items[0]?.chat;
    const workerName = this.getWorkerName(workerId);

    // 构建会话标题
    const otherParticipants = (chat?.participants ?? []).filter(p => p !== workerId);
    const chatTitle = chat?.title
      ?? (otherParticipants.length > 0 ? `与 ${otherParticipants.join('、')} 的对话` : chatId.slice(0, 8));

    // 构建注入 LLM 的 prompt
    const now = new Date().toLocaleString('zh-CN');
    const contextLines: string[] = [
      `【心跳唤醒 · ${now}】`,
      `你是「${workerName}」，以下是「${chatTitle}」会话的对话记录：`,
      '',
    ];

    // 注入历史消息
    const pendingIds = new Set(items.map(i => i.message.id));
    for (const msg of history) {
      if (pendingIds.has(msg.id)) continue; // 未读消息稍后单独列出
      const sender = msg.from === workerId ? `我（${workerName}）` : msg.from;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${sender}: ${msg.content}`);
    }

    contextLines.push('');
    contextLines.push('📬 以下是需要你处理的新消息：');
    for (const item of items) {
      const time = new Date(item.message.timestamp).toLocaleString('zh-CN');
      contextLines.push(`[${time}] ${item.message.from}: ${item.message.content}`);
    }
    contextLines.push('');
    contextLines.push('请回复上述消息。如果你认为无需回复（例如消息仅作通知用途），请回复 HEARTBEAT_OK。');

    const prompt = contextLines.join('\n');

    // 调用 AgentEngine 生成回复
    let response = '';
    try {
      for await (const chunk of agent.stream(prompt)) {
        if (chunk.type === 'text' && chunk.text) {
          response += chunk.text;
        }
      }
    } catch (err) {
      this.emit({
        type: 'heartbeat:error',
        workerId,
        error: `处理会话 ${chatId} 时出错: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies HeartbeatEvent);
      // 出错也要标记已读，避免下次重复触发
      await this.chatStore.markRead(chatId, workerId);
      return;
    }

    // 判断是否为 HEARTBEAT_OK（静默确认）
    const trimmed = response.trim();
    const isAck =
      trimmed === 'HEARTBEAT_OK' ||
      (trimmed.length <= 80 && trimmed.toUpperCase().includes('HEARTBEAT_OK'));

    if (!isAck && trimmed) {
      // Worker 有实际内容要回复，写回 ChatStore
      const lastItem = items[items.length - 1];
      await this.chatStore.sendMessage(chatId, workerId, trimmed, {
        replyToId: lastItem?.message.id,
      });

      this.emit({
        type: 'heartbeat:processed',
        workerId,
        chatId,
        replySent: true,
      } satisfies HeartbeatEvent);
    } else {
      // HEARTBEAT_OK：静默确认
      this.emit({
        type: 'heartbeat:processed',
        workerId,
        chatId,
        replySent: false,
      } satisfies HeartbeatEvent);
    }

    // 标记该会话的所有未读消息为已读
    await this.chatStore.markRead(chatId, workerId);
  }
}
