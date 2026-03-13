/**
 * @bcc/channel-telegram — TelegramChannel
 *
 * 通过 Telegram Bot 将用户消息路由到 BCC Worker，并将 Worker 回复实时发回 Telegram。
 *
 * 工作流程：
 *   1. 以长轮询模式持续调用 getUpdates
 *   2. 收到 message.text 时，查找该 Chat 绑定的 Worker（或使用默认 Worker）
 *   3. 调用 Worker.receive() 获取回复（若回复过长则分段发送）
 *   4. 通过 sendMessage 将回复写回 Telegram
 *
 * 特性：
 *   - 每个 Telegram Chat 与一个 Worker 绑定（多 Worker 时按 /switch 命令切换）
 *   - 消息过长时自动分割为 ≤ 4096 字符的片段（Telegram 限制）
 *   - 零额外依赖：仅使用 Node.js 内置 fetch
 */

import type { AgentInterface } from '@bcc/foundation';
import { TelegramApiClient } from './telegram-api.js';
import type { TelegramChannelConfig, TelegramMessage } from './types.js';

const MAX_MSG_LEN = 4096;   // Telegram 单条消息最大字符数
const LONG_POLL_SECONDS = 10; // 服务端等待时间（秒），减少空轮询次数

export interface TelegramChannelOptions extends TelegramChannelConfig {
  /**
   * 默认 Worker（接收所有未配置专属 Worker 的 Chat）。
   * 若不提供，Bot 只响应已通过 workerMap 明确分配的 Chat。
   */
  defaultAgent?: AgentInterface;

  /**
   * Chat ID → Worker 映射（用于多 Worker 场景）。
   * 不在映射中的 Chat 使用 defaultAgent。
   */
  workerMap?: Map<number, AgentInterface>;

  /**
   * Worker 名称映射（用于回复前缀，如 "【小明】"），可选。
   */
  workerNames?: Map<AgentInterface, string>;
}

export class TelegramChannel {
  private api: TelegramApiClient;
  private _running = false;
  private _stopResolve: (() => void) | undefined;

  // Chat ID → Worker 绑定（运行时动态分配）
  private chatBindings = new Map<number, AgentInterface>();
  // Worker 名称缓存
  private workerNames: Map<AgentInterface, string>;
  // 当前处理中的 Chat，避免同一 Chat 并发处理两条消息
  private processingChats = new Set<number>();

  private constructor(
    private readonly options: TelegramChannelOptions,
    private readonly defaultAgent: AgentInterface | undefined,
  ) {
    this.api = new TelegramApiClient(options.token, {
      ...(options.apiBase   !== undefined && { apiBase:   options.apiBase }),
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    });
    this.workerNames = options.workerNames ?? new Map();

    // 预填充静态 Chat→Worker 映射
    if (options.workerMap) {
      for (const [chatId, agent] of options.workerMap) {
        this.chatBindings.set(chatId, agent);
      }
    }
  }

  /**
   * 工厂方法：验证 Bot Token 并初始化渠道。
   * @throws 若 Token 无效或网络不可达则抛出错误
   */
  static async create(options: TelegramChannelOptions): Promise<TelegramChannel> {
    const channel = new TelegramChannel(options, options.defaultAgent);
    const me = await channel.api.getMe();
    if (!me) {
      throw new Error(`Telegram Bot Token 无效或无法连接到 Telegram API。`);
    }
    console.log(`  🤖 Telegram Bot @${me.username}（ID: ${me.id}）已验证`);
    return channel;
  }

  /**
   * 启动消息轮询循环（阻塞直到 stop() 被调用）。
   */
  async start(): Promise<void> {
    this._running = true;
    const intervalMs = this.options.pollIntervalMs ?? 2000;

    console.log(`  📡 Telegram 渠道已启动（长轮询间隔 ${LONG_POLL_SECONDS}s）`);
    if (this.options.allowedChatIds && this.options.allowedChatIds.length > 0) {
      console.log(`  🔒 白名单 Chat IDs：${this.options.allowedChatIds.join(', ')}`);
    } else {
      console.log(`  ⚠️  未设置 allowedChatIds，将响应所有用户消息`);
    }

    const stopPromise = new Promise<void>(resolve => {
      this._stopResolve = resolve;
    });

    const loop = async () => {
      while (this._running) {
        try {
          const updates = await this.api.getUpdates(LONG_POLL_SECONDS);
          for (const update of updates) {
            if (update.message) {
              void this._handleMessage(update.message).catch(err => {
                console.error(`  ⚠️  消息处理出错：${err instanceof Error ? err.message : String(err)}`);
              });
            }
          }
        } catch (err) {
          if (this._running) {
            // 网络错误时短暂等待后重试，避免 CPU 空转
            console.error(`  ⚠️  轮询出错，${intervalMs / 1000}s 后重试：${err instanceof Error ? err.message : String(err)}`);
            await new Promise(r => setTimeout(r, intervalMs));
          }
        }
      }
    };

    void loop();
    await stopPromise;
  }

  /**
   * 停止消息轮询。
   */
  stop(): void {
    this._running = false;
    this._stopResolve?.();
  }

  /**
   * 动态绑定：将某个 Chat 与指定 Worker 关联。
   * 可在运行中调用，无需重启渠道。
   */
  bindChat(chatId: number, agent: AgentInterface): void {
    this.chatBindings.set(chatId, agent);
  }

  // ─── 内部消息处理 ─────────────────────────────────────────────────────────

  private async _handleMessage(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text   = msg.text?.trim();

    // 忽略非文本消息（图片、贴纸等）
    if (!text) return;

    // 白名单过滤
    if (
      this.options.allowedChatIds &&
      this.options.allowedChatIds.length > 0 &&
      !this.options.allowedChatIds.includes(chatId)
    ) {
      await this.api.sendMessage(chatId, '⚠️ 你没有权限使用此 Bot。');
      return;
    }

    // 内置命令处理
    if (text.startsWith('/')) {
      await this._handleCommand(chatId, text, msg);
      return;
    }

    // 防并发：同一 Chat 不同时处理两条消息
    if (this.processingChats.has(chatId)) {
      await this.api.sendMessage(chatId, '⏳ 上一条消息仍在处理中，请稍候…');
      return;
    }

    // 查找绑定的 Worker
    const agent = this.chatBindings.get(chatId) ?? this.defaultAgent;
    if (!agent) {
      await this.api.sendMessage(chatId, '⚠️ 没有可用的 Worker 处理此消息。请联系管理员配置。');
      return;
    }

    this.processingChats.add(chatId);
    try {
      // 发送"正在输入"状态
      void this.api.sendChatAction(chatId);

      // 收集 LLM 回复（非流式，完整等待后发送）
      let reply = '';
      for await (const chunk of agent.stream(text)) {
        if (chunk.type === 'text' && chunk.text) {
          reply += chunk.text;
        }
      }

      if (!reply.trim()) {
        reply = '（Worker 没有生成回复）';
      }

      // Worker 名称前缀（多 Worker 场景有助于区分发言人）
      const workerName = this.workerNames.get(agent);
      const prefix = workerName ? `【${workerName}】\n` : '';

      // 分段发送（Telegram 单条消息上限 4096 字符）
      await this._sendLong(chatId, prefix + reply);
    } finally {
      this.processingChats.delete(chatId);
    }
  }

  private async _handleCommand(chatId: number, text: string, _msg: TelegramMessage): Promise<void> {
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd) {
      case '/start':
      case '/help': {
        const helpText = [
          '👋 你好！我是 BCC AI 助手。',
          '',
          '可用命令：',
          '  /help — 显示此帮助',
          '  /clear — 清空当前对话历史',
          '  /status — 查看当前绑定的 Worker',
        ].join('\n');
        await this.api.sendMessage(chatId, helpText);
        break;
      }

      case '/clear': {
        const agent = this.chatBindings.get(chatId) ?? this.defaultAgent;
        if (agent) {
          agent.clearHistory();
          await this.api.sendMessage(chatId, '✅ 对话历史已清空。');
        } else {
          await this.api.sendMessage(chatId, '⚠️ 没有绑定的 Worker。');
        }
        break;
      }

      case '/status': {
        const agent = this.chatBindings.get(chatId) ?? this.defaultAgent;
        const workerName = agent ? (this.workerNames.get(agent) ?? '未命名 Worker') : '未绑定';
        const model = agent?.currentModel ?? '—';
        await this.api.sendMessage(
          chatId,
          `📊 当前状态\n  Worker：${workerName}\n  模型：${model}`,
        );
        break;
      }

      default: {
        const unknownCmd = cmd ?? '/unknown';
        await this.api.sendMessage(chatId, `⚠️ 未知命令：${unknownCmd}。发送 /help 查看帮助。`);
        void args; // suppress unused variable warning
        break;
      }
    }
  }

  /**
   * 将长文本拆分为多条消息发送（避免超过 Telegram 4096 字符限制）。
   */
  private async _sendLong(chatId: number, text: string): Promise<void> {
    if (text.length <= MAX_MSG_LEN) {
      await this.api.sendMessage(chatId, text);
      return;
    }

    // 按段落边界（双换行）拆分，避免截断 Markdown 块
    const parts: string[] = [];
    let current = '';
    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > MAX_MSG_LEN) {
        if (current) parts.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) parts.push(current);

    for (const part of parts) {
      await this.api.sendMessage(chatId, part);
    }
  }
}
