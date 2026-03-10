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
  role: string;
  tools: string[];
  isPrimary: boolean;
  /** 运行时状态（简单标记，未来可接 heartbeat） */
  status: 'online' | 'idle' | 'offline';
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface ApiSession {
  id: string;
  workerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ApiMessage {
  id: string;
  role: 'user' | 'assistant';
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

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byWorker: WorkerTokenStats[];
}

export interface WorkerTokenStats {
  workerId: string;
  workerName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

// ─── SSE 事件 ─────────────────────────────────────────────────────────────────

export type SseEvent =
  | { event: 'chunk';       data: { text: string } }
  | { event: 'tool_call';   data: { tool: string; input: Record<string, unknown> } }
  | { event: 'tool_result'; data: { tool: string; result: string; isError: boolean } }
  | { event: 'done';        data: { tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } } }
  | { event: 'error';       data: { message: string } };
