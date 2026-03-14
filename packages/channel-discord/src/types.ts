/**
 * @bcc/channel-discord — Discord Gateway & REST API 类型（最小化子集）
 *
 * 仅包含本渠道所需字段，避免引入 discord.js 等重量级依赖。
 *
 * 参考：https://discord.com/developers/docs/topics/gateway
 */

// ─── Discord REST API 类型 ─────────────────────────────────────────────────────

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  referenced_message?: DiscordMessage;
}

// ─── Gateway 事件 ─────────────────────────────────────────────────────────────

export type GatewayOpcode =
  | 0   // DISPATCH
  | 1   // HEARTBEAT
  | 2   // IDENTIFY
  | 7   // RECONNECT
  | 9   // INVALID_SESSION
  | 10  // HELLO
  | 11; // HEARTBEAT_ACK

export interface GatewayPayload {
  op: GatewayOpcode;
  d?: unknown;
  s?: number;
  t?: string;
}

// ─── 渠道配置 ─────────────────────────────────────────────────────────────────

export interface DiscordChannelConfig {
  /**
   * Discord Bot Token（在 Discord Developer Portal 创建 Application 后获得）。
   */
  token: string;

  /**
   * 允许响应的 Discord Channel ID 白名单（可选）。
   * 不填则响应所有频道消息（谨慎使用）。
   */
  allowedChannelIds?: string[];

  /**
   * 允许响应的 Discord Guild（服务器）ID（可选）。
   * 不填则响应所有服务器的消息。
   */
  allowedGuildIds?: string[];

  /**
   * 命令前缀（默认 "!"）。
   * 用于识别 Bot 命令（如 !help、!clear）。
   */
  commandPrefix?: string;

  /**
   * Discord REST API 基础地址（默认 https://discord.com/api/v10）。
   */
  apiBase?: string;
}
