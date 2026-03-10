/**
 * BCC API Client
 *
 * 封装所有对后端（@bcc/channel-http）的请求。
 * 开发时 Vite proxy 将 /api 转发到 http://localhost:3000/api。
 */

const BASE = '/api';

// ─── 通用工具 ──────────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ─── 类型（与 @bcc/channel-http/src/types.ts 保持一致）───────────────────────

export interface ApiWorker {
  id: string;
  name: string;
  description: string;
  skills: string[];
  modelId: string;
  role: string;
  tools: string[];
  isPrimary: boolean;
  status: 'online' | 'idle' | 'offline';
}

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
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface ApiSessionDetail extends ApiSession {
  messages: ApiMessage[];
}

export interface ApiModel {
  id: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  isPrimary: boolean;
  isFallback: boolean;
}

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byWorker: {
    workerId: string;
    workerName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    callCount: number;
  }[];
}

// ─── Worker API ───────────────────────────────────────────────────────────────

export const workersApi = {
  list: () => get<ApiWorker[]>('/workers'),
};

// ─── Session API ──────────────────────────────────────────────────────────────

export const sessionsApi = {
  create:       (workerId: string)               => post<ApiSession>(`/workers/${workerId}/sessions`),
  listByWorker: (workerId: string)               => get<ApiSession[]>(`/workers/${workerId}/sessions`),
  get:          (sessionId: string)              => get<ApiSessionDetail>(`/sessions/${sessionId}`),
  delete:       (sessionId: string)              => del(`/sessions/${sessionId}`),
};

// ─── SSE 流式发送消息 ─────────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk:      (text: string) => void;
  onToolCall?:  (tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (tool: string, result: string, isError: boolean) => void;
  onDone:       (tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number }) => void;
  onError:      (message: string) => void;
}

export async function sendMessageStream(
  sessionId: string,
  content: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!res.ok || !res.body) {
    callbacks.onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          switch (currentEvent) {
            case 'chunk':
              callbacks.onChunk((data['text'] as string) ?? '');
              break;
            case 'tool_call':
              callbacks.onToolCall?.(data['tool'] as string, data['input'] as Record<string, unknown>);
              break;
            case 'tool_result':
              callbacks.onToolResult?.(data['tool'] as string, data['result'] as string, data['isError'] as boolean);
              break;
            case 'done':
              callbacks.onDone(data['tokenUsage'] as { inputTokens: number; outputTokens: number; totalTokens: number } | undefined);
              break;
            case 'error':
              callbacks.onError(data['message'] as string);
              break;
          }
        } catch {
          // 跳过解析失败的行
        }
        currentEvent = '';
      }
    }
  }
}

// ─── Models API ───────────────────────────────────────────────────────────────

export const modelsApi = {
  list: () => get<ApiModel[]>('/models'),
};

// ─── Analytics API ────────────────────────────────────────────────────────────

export const analyticsApi = {
  tokens: () => get<TokenStats>('/analytics/tokens'),
};

// ─── 健康检查（判断后端是否可用）─────────────────────────────────────────────

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
