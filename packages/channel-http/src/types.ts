/**
 * @bcc/channel-http — API 类型定义
 *
 * 与 Web 前端 (packages/web) 共享数据形状。
 * Worker / Session / Message 均使用这些类型。
 */

// ─── Worker ────────────────────────────────────────────────────────────────────

export interface ApiWorker {
  id: string;
  name: string;
  description: string;
  skills: string[];
  modelId: string;
  /** 可选：心跳/收件箱审视用的轻量模型 ID */
  reviewModelId?: string;
  /**
   * 心跳检测间隔（毫秒）。
   * - undefined：默认 30 秒主动轮询
   * - 0：被动模式，不启动定时器
   * - >0：主动轮询，按指定间隔
   */
  heartbeatIntervalMs?: number;
  role: string;
  tools: string[];
  isPrimary: boolean;
  /** 运行时状态（简单标记，未来可接 heartbeat） */
  status: 'online' | 'idle' | 'offline';
}

// ─── Session ──────────────────────────────────────────────────────────────────

/** 会话类型：chat = 用户↔Worker；dm = Worker↔Worker 直接消息；group = 用户↔多 Worker 群聊 */
export type SessionType = 'chat' | 'dm' | 'group';

export interface ApiSession {
  id: string;
  type: SessionType;
  workerId: string;
  /** DM 会话中接收方 Worker ID */
  toWorkerId?: string;
  /** group 会话中所有参与 Worker ID 列表 */
  workerIds?: string[];
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ApiMessage {
  id: string;
  role: 'user' | 'assistant';
  /** DM 会话中标记发言 Worker ID */
  speakerId?: string;
  content: string;
  timestamp: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ApiSessionDetail extends ApiSession {
  messages: ApiMessage[];
}

// ─── Model ────────────────────────────────────────────────────────────────────

export interface ApiModel {
  id: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  isPrimary: boolean;
  isFallback: boolean;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface DailyTokenStats {
  /** YYYY-MM-DD */
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byWorker: WorkerTokenStats[];
  /** 按天分组的 Token 消耗，最近 30 天，无数据的天不包含 */
  byDay: DailyTokenStats[];
}

export interface WorkerTokenStats {
  workerId: string;
  workerName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

/** 持久化的单条 token 消耗记录 */
export interface TokenRecord {
  workerId: string;
  workerName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Unix timestamp (ms) */
  timestamp: number;
}

// ─── SSE 事件 ─────────────────────────────────────────────────────────────────

export type SseEvent =
  | { event: 'chunk';       data: { text: string } }
  | { event: 'speaker';     data: { workerId: string; workerName: string } }
  | { event: 'tool_call';   data: { tool: string; input: Record<string, unknown> } }
  | { event: 'tool_result'; data: { tool: string; result: string; isError: boolean } }
  | { event: 'done';        data: { tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } } }
  | { event: 'error';       data: { message: string } };
