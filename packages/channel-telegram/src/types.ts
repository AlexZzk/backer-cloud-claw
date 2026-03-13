/**
 * @bcc/channel-telegram — Telegram Bot API 类型（最小化子集）
 *
 * 仅包含本渠道所需字段，避免引入完整的 @types/node-telegram-bot-api 依赖。
 */

// ─── Telegram Bot API 响应体 ───────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// ─── 渠道配置 ─────────────────────────────────────────────────────────────────

export interface TelegramChannelConfig {
  /**
   * Telegram Bot Token（由 @BotFather 创建后获得）。
   * 格式：`123456789:AAHxxxx…`
   */
  token: string;

  /**
   * 允许响应的 Telegram Chat ID 白名单（可选）。
   * 不填则响应所有用户（不推荐在生产环境使用）。
   */
  allowedChatIds?: number[];

  /**
   * 轮询间隔（毫秒，默认 2000）。
   * 不建议低于 1000 以避免触发 Telegram 限流。
   */
  pollIntervalMs?: number;

  /**
   * 请求超时（毫秒，默认 10000）。
   */
  timeoutMs?: number;

  /**
   * Telegram Bot API 端点（默认 https://api.telegram.org）。
   * 可替换为自建 Local Bot API Server 地址。
   */
  apiBase?: string;
}
