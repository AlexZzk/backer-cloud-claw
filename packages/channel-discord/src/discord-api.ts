/**
 * Discord REST API 客户端（零依赖，使用 Node.js 内置 fetch）。
 *
 * 仅封装本渠道所需的接口：发送消息、标记输入中等。
 */

import type { DiscordMessage } from './types.js';

const DEFAULT_API_BASE = 'https://discord.com/api/v10';

export class DiscordRestClient {
  private base: string;

  constructor(
    private readonly token: string,
    options?: { apiBase?: string },
  ) {
    this.base = (options?.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  }

  /**
   * 在指定频道发送消息。
   */
  async createMessage(
    channelId: string,
    content: string,
    options?: { messageReference?: { message_id: string } },
  ): Promise<DiscordMessage | null> {
    const body: Record<string, unknown> = { content };
    if (options?.messageReference) {
      body['message_reference'] = options.messageReference;
    }

    const res = await this._fetch(
      `${this.base}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.token}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) return null;
    return (await res.json()) as DiscordMessage;
  }

  /**
   * 触发"正在输入"状态（持续约 10 秒）。
   */
  async triggerTyping(channelId: string): Promise<void> {
    await this._fetch(`${this.base}/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { Authorization: `Bot ${this.token}` },
    });
  }

  /**
   * 获取 Bot 自身用户信息（验证 Token + 健康检查）。
   */
  async getCurrentUser(): Promise<{ id: string; username: string } | null> {
    const res = await this._fetch(`${this.base}/users/@me`, {
      headers: { Authorization: `Bot ${this.token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; username: string };
  }

  private async _fetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    return res;
  }
}
