/**
 * Discord Gateway WebSocket 客户端（零依赖，使用 Node.js 内置 WebSocket）。
 *
 * 实现 Discord Gateway 协议的核心流程：
 *   1. 连接到 wss://gateway.discord.gg
 *   2. 收到 HELLO（op=10）后开始发送心跳
 *   3. 发送 IDENTIFY（op=2）进行身份验证
 *   4. 接收 DISPATCH（op=0）事件并回调处理函数
 *   5. 断线时自动尝试 RESUME，失败则重新 IDENTIFY
 *
 * Node.js 22+ 内置 WebSocket，低版本需在启动前设置 --experimental-websocket。
 */

import type { GatewayPayload, DiscordMessage } from './types.js';

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
/** 最大重连次数（之后放弃，避免无限重连） */
const MAX_RECONNECT_ATTEMPTS = 10;
/** 初始重连等待（ms），每次翻倍 */
const RECONNECT_BASE_MS = 1000;

export interface GatewayOptions {
  token: string;
  intents: number;
  onMessage: (msg: DiscordMessage, botId: string) => void;
  onReady?: (botId: string, botUsername: string) => void;
}

export class DiscordGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private botId = '';
  private reconnectAttempts = 0;
  private _stopped = false;

  constructor(private readonly opts: GatewayOptions) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._connect(resolve, reject);
    });
  }

  stop(): void {
    this._stopped = true;
    this._clearHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Stopping');
      this.ws = null;
    }
  }

  private _connect(onReady?: () => void, onError?: (e: Error) => void): void {
    const url = this.resumeGatewayUrl ?? GATEWAY_URL;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
    });

    ws.addEventListener('message', (event) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(event.data as string) as GatewayPayload;
      } catch {
        return;
      }
      this._handlePayload(payload, onReady);
    });

    ws.addEventListener('error', (event) => {
      console.error(`  ⚠️  Discord Gateway 错误：${String(event)}`);
      onError?.(new Error('Gateway WebSocket error'));
    });

    ws.addEventListener('close', (event) => {
      this._clearHeartbeat();
      if (!this._stopped) {
        console.warn(`  ⚠️  Discord Gateway 已断开（code=${event.code}），准备重连…`);
        this._scheduleReconnect();
      }
    });
  }

  private _handlePayload(payload: GatewayPayload, onConnected?: () => void): void {
    if (payload.s) this.sequence = payload.s;

    switch (payload.op) {
      case 10: { // HELLO
        const d = payload.d as { heartbeat_interval: number };
        this._startHeartbeat(d.heartbeat_interval);

        // RESUME or IDENTIFY
        if (this.sessionId && this.sequence !== null) {
          this._send({ op: 6, d: { token: this.opts.token, session_id: this.sessionId, seq: this.sequence } });
        } else {
          this._identify();
        }
        break;
      }

      case 11: // HEARTBEAT_ACK
        break;

      case 1: // HEARTBEAT request
        this._sendHeartbeat();
        break;

      case 7: // RECONNECT
        this.ws?.close();
        break;

      case 9: { // INVALID_SESSION
        const resumable = payload.d as boolean;
        if (!resumable) {
          this.sessionId = null;
          this.sequence = null;
        }
        setTimeout(() => this._identify(), 1000 + Math.random() * 4000);
        break;
      }

      case 0: { // DISPATCH
        if (payload.t === 'READY') {
          const d = payload.d as { session_id: string; user: { id: string; username: string }; resume_gateway_url: string };
          this.sessionId = d.session_id;
          this.botId = d.user.id;
          this.resumeGatewayUrl = d.resume_gateway_url;
          this.opts.onReady?.(d.user.id, d.user.username);
          onConnected?.();
        } else if (payload.t === 'MESSAGE_CREATE') {
          const msg = payload.d as DiscordMessage;
          if (msg.author.bot) return; // 忽略 Bot 自身消息
          this.opts.onMessage(msg, this.botId);
        }
        break;
      }
    }
  }

  private _identify(): void {
    this._send({
      op: 2,
      d: {
        token: this.opts.token,
        intents: this.opts.intents,
        properties: { os: 'linux', browser: 'bcc', device: 'bcc' },
      },
    });
  }

  private _startHeartbeat(intervalMs: number): void {
    this._clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this._sendHeartbeat(), intervalMs);
    // 立即发送一次（jitter 避免和服务端同步）
    setTimeout(() => this._sendHeartbeat(), Math.random() * intervalMs);
  }

  private _sendHeartbeat(): void {
    this._send({ op: 1, d: this.sequence });
  }

  private _clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private _scheduleReconnect(): void {
    if (this._stopped) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('  ✗  Discord Gateway 重连次数超限，已放弃。');
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), 60_000);
    console.log(`  🔄 ${delay / 1000}s 后尝试第 ${this.reconnectAttempts} 次重连…`);
    setTimeout(() => this._connect(), delay);
  }
}
