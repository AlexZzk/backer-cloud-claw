/**
 * @bcc/channel-discord — DiscordChannel
 *
 * 通过 Discord Gateway WebSocket 将用户消息路由到 BCC Worker，
 * 并将 Worker 回复发回对应频道。
 *
 * Discord Intents（本渠道所需）：
 *   - GUILDS           (1 << 0)  = 1
 *   - GUILD_MESSAGES   (1 << 9)  = 512
 *   - MESSAGE_CONTENT  (1 << 15) = 32768  ← 需在 Developer Portal 开启 Privileged Intent
 *
 * 完整 intents 值：1 | 512 | 32768 = 33281
 *
 * 特性：
 *   - 支持 @mention Bot 触发（防止响应所有消息造成刷屏）
 *   - 支持命令前缀（默认 "!"）
 *   - 消息超过 2000 字符时自动分段（Discord 单条消息上限）
 *   - 零额外依赖：仅使用 Node.js 内置 WebSocket + fetch
 */

import type { AgentInterface } from '@bcc/foundation';
import { DiscordRestClient } from './discord-api.js';
import { DiscordGateway } from './gateway.js';
import type { DiscordChannelConfig, DiscordMessage } from './types.js';

/** Discord 单条消息最大字符数 */
const MAX_MSG_LEN = 2000;

/** Discord Gateway Intents：GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT */
const DEFAULT_INTENTS = 1 | 512 | 32768;

export interface DiscordChannelOptions extends DiscordChannelConfig {
  /** 默认 Worker（处理未单独配置的频道消息） */
  defaultAgent?: AgentInterface;

  /** Channel ID → Worker 映射（按频道分配专属 Worker） */
  workerMap?: Map<string, AgentInterface>;

  /** Worker 名称映射（用于回复前缀显示） */
  workerNames?: Map<AgentInterface, string>;

  /**
   * 是否仅在被 @mention 时响应（默认 true）。
   * 设为 false 时响应所有消息（仅推荐在私信场景使用）。
   */
  onlyWhenMentioned?: boolean;

  /** Gateway Intents（默认 33281 = GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT） */
  intents?: number;
}

export class DiscordChannel {
  private rest: DiscordRestClient;
  private gateway: DiscordGateway | null = null;
  private botId = '';
  private processingChannels = new Set<string>();

  private constructor(
    private readonly options: DiscordChannelOptions,
    private readonly defaultAgent: AgentInterface | undefined,
  ) {
    this.rest = new DiscordRestClient(options.token, {
      ...(options.apiBase !== undefined && { apiBase: options.apiBase }),
    });
  }

  /**
   * 工厂方法：验证 Bot Token 并初始化渠道。
   */
  static async create(options: DiscordChannelOptions): Promise<DiscordChannel> {
    const channel = new DiscordChannel(options, options.defaultAgent);
    const me = await channel.rest.getCurrentUser();
    if (!me) {
      throw new Error('Discord Bot Token 无效或无法连接到 Discord API。');
    }
    console.log(`  🤖 Discord Bot @${me.username}（ID: ${me.id}）已验证`);
    return channel;
  }

  /**
   * 连接到 Discord Gateway 并开始处理消息（阻塞直到 stop() 被调用）。
   */
  async start(): Promise<void> {
    const intents = this.options.intents ?? DEFAULT_INTENTS;
    const onlyMentioned = this.options.onlyWhenMentioned ?? true;

    console.log(`  📡 Discord 渠道已启动（intents: ${intents}，仅 @mention: ${onlyMentioned}）`);
    if (this.options.allowedChannelIds?.length) {
      console.log(`  🔒 白名单频道：${this.options.allowedChannelIds.join(', ')}`);
    }

    this.gateway = new DiscordGateway({
      token:   this.options.token,
      intents,
      onReady: (botId, botUsername) => {
        this.botId = botId;
        console.log(`  ✅ Discord Gateway 已就绪，Bot: @${botUsername}（${botId}）`);
      },
      onMessage: (msg, botId) => {
        void this._handleMessage(msg, botId, onlyMentioned).catch(err => {
          console.error(`  ⚠️  Discord 消息处理出错：${err instanceof Error ? err.message : String(err)}`);
        });
      },
    });

    return this.gateway.connect();
  }

  stop(): void {
    this.gateway?.stop();
  }

  // ─── 内部消息处理 ─────────────────────────────────────────────────────────

  private async _handleMessage(
    msg: DiscordMessage,
    botId: string,
    onlyMentioned: boolean,
  ): Promise<void> {
    const channelId = msg.channel_id;
    const content   = msg.content.trim();

    if (!content) return;

    // 白名单过滤（Channel 和 Guild）
    if (
      this.options.allowedChannelIds?.length &&
      !this.options.allowedChannelIds.includes(channelId)
    ) {
      return;
    }

    // @mention 检测：消息中是否包含 <@botId>
    const isMentioned = content.includes(`<@${botId}>`);
    if (onlyMentioned && !isMentioned) return;

    // 去掉 @mention 前缀，取纯净内容
    const cleanContent = content
      .replace(new RegExp(`<@${botId}>\\s*`, 'g'), '')
      .trim();

    if (!cleanContent) {
      await this.rest.createMessage(channelId, '嗯？你叫我有什么事吗？😊');
      return;
    }

    // 命令处理
    const prefix = this.options.commandPrefix ?? '!';
    if (cleanContent.startsWith(prefix)) {
      await this._handleCommand(channelId, cleanContent.slice(prefix.length).trim(), msg);
      return;
    }

    // 防并发
    if (this.processingChannels.has(channelId)) {
      await this.rest.createMessage(channelId, '⏳ 上一条消息仍在处理中，请稍候…');
      return;
    }

    // 查找绑定的 Worker
    const agent =
      this.options.workerMap?.get(channelId) ??
      this.defaultAgent;

    if (!agent) {
      await this.rest.createMessage(channelId, '⚠️ 没有可用的 Worker 处理此消息，请联系管理员。');
      return;
    }

    this.processingChannels.add(channelId);
    try {
      void this.rest.triggerTyping(channelId);

      let reply = '';
      for await (const chunk of agent.stream(cleanContent)) {
        if (chunk.type === 'text' && chunk.text) reply += chunk.text;
      }

      if (!reply.trim()) reply = '（Worker 没有生成回复）';

      const workerName = this.options.workerNames?.get(agent);
      const prefix2 = workerName ? `**【${workerName}】**\n` : '';

      await this._sendLong(channelId, prefix2 + reply, msg.id);
    } finally {
      this.processingChannels.delete(channelId);
    }
  }

  private async _handleCommand(
    channelId: string,
    cmd: string,
    _msg: DiscordMessage,
  ): Promise<void> {
    const [command] = cmd.split(/\s+/);
    switch (command) {
      case 'help': {
        const helpText = [
          '**BCC AI 助手命令**',
          '',
          `\`${this.options.commandPrefix ?? '!'}help\` — 显示此帮助`,
          `\`${this.options.commandPrefix ?? '!'}clear\` — 清空当前对话历史`,
          `\`${this.options.commandPrefix ?? '!'}status\` — 查看当前 Worker 状态`,
          '',
          '也可以直接 @我 发送消息。',
        ].join('\n');
        await this.rest.createMessage(channelId, helpText);
        break;
      }

      case 'clear': {
        const agent = this.options.workerMap?.get(channelId) ?? this.defaultAgent;
        if (agent) {
          agent.clearHistory();
          await this.rest.createMessage(channelId, '✅ 对话历史已清空。');
        } else {
          await this.rest.createMessage(channelId, '⚠️ 没有绑定的 Worker。');
        }
        break;
      }

      case 'status': {
        const agent = this.options.workerMap?.get(channelId) ?? this.defaultAgent;
        const workerName = agent ? (this.options.workerNames?.get(agent) ?? '未命名 Worker') : '未绑定';
        const model = agent?.currentModel ?? '—';
        await this.rest.createMessage(
          channelId,
          `**📊 当前状态**\nWorker：${workerName}\n模型：${model}`,
        );
        break;
      }

      default:
        await this.rest.createMessage(channelId, `⚠️ 未知命令：\`${command ?? cmd}\`。发送 \`${this.options.commandPrefix ?? '!'}help\` 查看帮助。`);
    }
  }

  /**
   * 将长文本拆分为多条消息（Discord 单条上限 2000 字符）。
   */
  private async _sendLong(
    channelId: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    if (text.length <= MAX_MSG_LEN) {
      await this.rest.createMessage(
        channelId,
        text,
        replyToMessageId ? { messageReference: { message_id: replyToMessageId } } : undefined,
      );
      return;
    }

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

    let first = true;
    for (const part of parts) {
      await this.rest.createMessage(
        channelId,
        part,
        first && replyToMessageId ? { messageReference: { message_id: replyToMessageId } } : undefined,
      );
      first = false;
    }
  }
}
