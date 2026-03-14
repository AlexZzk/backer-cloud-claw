/**
 * Telegram Bot API 客户端（零依赖实现，使用 Node.js 内置 fetch）。
 *
 * 封装与 Telegram 服务端的 HTTP 通信，提供类型安全的接口。
 * 使用长轮询（long polling）模式，无需配置 webhook。
 */

import type {
  TelegramMessage,
  TelegramResponse,
  TelegramUpdate,
} from './types.js';

const DEFAULT_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 10_000;

export class TelegramApiClient {
  private base: string;
  private timeoutMs: number;
  /** getUpdates 长轮询的最近 offset（offset = lastUpdateId + 1） */
  private offset = 0;

  constructor(
    private readonly token: string,
    options?: { apiBase?: string; timeoutMs?: number },
  ) {
    this.base = (options?.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─── 核心 API ─────────────────────────────────────────────────────────────

  /**
   * 长轮询获取新更新（调用 getUpdates）。
   * 每次调用都会推进 offset，确保消息不重复消费。
   *
   * @param longPollSeconds 服务端等待时间（秒，默认 0 = 短轮询，最大 50）
   */
  async getUpdates(longPollSeconds = 0): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      offset: String(this.offset),
      timeout: String(longPollSeconds),
      allowed_updates: JSON.stringify(['message']),
    });
    const url = `${this.base}/bot${this.token}/getUpdates?${params}`;

    const res = await this._fetch(url, undefined, longPollSeconds * 1000 + this.timeoutMs);
    const data = (await res.json()) as TelegramResponse<TelegramUpdate[]>;

    if (!data.ok || !data.result) return [];

    // 推进 offset：下次拉取时跳过已处理的更新
    if (data.result.length > 0) {
      const last = data.result[data.result.length - 1]!;
      this.offset = last.update_id + 1;
    }
    return data.result;
  }

  /**
   * 发送文本消息（支持 Markdown / HTML 格式化）。
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: { parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
  ): Promise<TelegramMessage | null> {
    const body = {
      chat_id: chatId,
      text,
      ...(options?.parseMode && { parse_mode: options.parseMode }),
    };
    const res = await this._fetch(
      `${this.base}/bot${this.token}/sendMessage`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const data = (await res.json()) as TelegramResponse<TelegramMessage>;
    return data.ok && data.result ? data.result : null;
  }

  /**
   * 发送"正在输入…"状态（让用户在等待 LLM 回复时看到打字提示）。
   */
  async sendChatAction(chatId: number | string, action = 'typing'): Promise<void> {
    const body = { chat_id: chatId, action };
    await this._fetch(
      `${this.base}/bot${this.token}/sendChatAction`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  }

  /**
   * 获取 Bot 自身信息（用于验证 token + 健康检查）。
   */
  async getMe(): Promise<{ id: number; username: string } | null> {
    const res = await this._fetch(`${this.base}/bot${this.token}/getMe`);
    const data = (await res.json()) as TelegramResponse<{ id: number; username: string }>;
    return data.ok && data.result ? data.result : null;
  }

  // ─── 内部工具 ─────────────────────────────────────────────────────────────

  private async _fetch(
    url: string,
    init?: RequestInit,
    timeoutOverride?: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutOverride ?? this.timeoutMs,
    );
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Telegram API HTTP ${res.status}: ${await res.text()}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
