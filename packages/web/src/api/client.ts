/**
 * BCC API Client
 *
 * 封装所有对后端（@bcc/channel-http）的请求。
 * 开发时 Vite proxy 将 /bcc_server 转发到 http://localhost:3000。
 */

import service from '@/http/axios.ts'

// ─── 类型 ───────────────────────────────────────────────────────────────

export interface ApiWorker {
  id: string
  name: string
  description: string
  skills: string[]
  modelId: string
  role: string
  tools: string[]
  isPrimary: boolean
  status: 'online' | 'idle' | 'offline'
}

export type SessionType = 'chat' | 'dm' | 'group'

export interface ApiSession {
  id: string
  type: SessionType
  workerId: string
  toWorkerId?: string
  /** group 会话中所有参与 Worker IDs */
  workerIds?: string[]
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ApiMessage {
  id: string
  role: 'user' | 'assistant'
  speakerId?: string
  content: string
  timestamp: number
  tokenUsage?: { inputTokens: number; outputTokens: number }
}

export interface ApiSessionDetail extends ApiSession {
  messages: ApiMessage[]
}

export interface ApiModel {
  id: string
  provider: string
  model?: string
  baseUrl?: string
  isPrimary: boolean
  isFallback: boolean
}

export interface TokenStats {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  byWorker: {
    workerId: string
    workerName: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    callCount: number
  }[]
}

// ─── Worker API ─────────────────────────────────────────────────────────

export interface ApiWorkerInput {
  id: string
  name: string
  description: string
  role: string
  modelId: string
  skills: string[]
  tools: string[]
  isPrimary?: boolean
}

// class WorkerListApi {
//   async getWorkers() {
//     return service({
//       url: '/workers',
//       method: 'get',
//     })
//   }
// }

export const workersApi = {
  list: () => service.get<ApiWorker[]>('/workers'),

  create: (data: ApiWorkerInput) =>
      service.post<ApiWorker>('/workers', { ...data, primary: data.isPrimary }),

  update: (id: string, data: Partial<ApiWorkerInput>) =>
      service.put<ApiWorker>(`/workers/${id}`, { ...data, primary: data.isPrimary }),

  delete: (id: string) =>
      service.delete(`/workers/${id}`)
}

// ─── Session API ────────────────────────────────────────────────────────

export const sessionsApi = {
  create: (workerId: string) =>
      service.post<ApiSession>(`/workers/${workerId}/sessions`),

  listByWorker: (workerId: string) =>
      service.get<ApiSession[]>(`/workers/${workerId}/sessions`),

  get: (sessionId: string) =>
      service.get<ApiSessionDetail>(`/sessions/${sessionId}`),

  delete: (sessionId: string) =>
      service.delete(`/sessions/${sessionId}`)
}

export const dmApi = {
  create: (fromWorkerId: string, toWorkerId: string) =>
      service.post<ApiSession>('/dm-sessions', { fromWorkerId, toWorkerId })
}

export const groupApi = {
  /** 创建用户↔多 Worker 群聊会话（至少 2 个 Worker） */
  create: (workerIds: string[]) =>
      service.post<ApiSession>('/group-sessions', { workerIds })
}

// ─── SSE 流式消息 ───────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onSpeaker?: (workerId: string, workerName: string) => void
  onToolCall?: (tool: string, input: Record<string, unknown>) => void
  onToolResult?: (tool: string, result: string, isError: boolean) => void
  onDone: (tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  onError: (message: string) => void
}

export async function sendMessageStream(
    sessionId: string,
    content: string,
    callbacks: StreamCallbacks
): Promise<void> {

  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  })

  if (!res.ok || !res.body) {
    callbacks.onError(`HTTP ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let currentEvent = ''

    for (const line of lines) {

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (line.startsWith('data: ')) {

        try {
          const data = JSON.parse(line.slice(6))

          switch (currentEvent) {

            case 'chunk':
              callbacks.onChunk(data.text ?? '')
              break

            case 'speaker':
              callbacks.onSpeaker?.(data.workerId, data.workerName)
              break

            case 'tool_call':
              callbacks.onToolCall?.(data.tool, data.input)
              break

            case 'tool_result':
              callbacks.onToolResult?.(data.tool, data.result, data.isError)
              break

            case 'done':
              callbacks.onDone(data.tokenUsage)
              break

            case 'error':
              callbacks.onError(data.message)
              break
          }

        } catch {
          // ignore parse error
        }

        currentEvent = ''
      }
    }
  }
}

// ─── Models API ─────────────────────────────────────────────────────────

export interface ApiModelInput {
  id: string
  provider: string
  apiKey?: string
  model?: string
  baseUrl?: string
  isPrimary?: boolean
  isFallback?: boolean
}

export const modelsApi = {
  list: () =>
    service.get<ApiModel[]>('/models'),

  create: (data: ApiModelInput) =>
      service.post<ApiModel>('/models', data),

  update: (id: string, data: Partial<ApiModelInput>) =>
      service.put<ApiModel>(`/models/${id}`, data),

  delete: (id: string) =>
      service.delete(`/models/${id}`)
}

// ─── Async Chats API (Worker↔Worker 异步聊天，来自 CLI 的 send_message 工具) ─

export interface ApiAsyncChat {
  id: string
  type: 'direct' | 'group'
  participants: string[]
  title?: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
  lastMessage?: {
    from: string
    content: string
    timestamp: number
  }
}

export interface ApiAsyncChatMessage {
  id: string
  chatId: string
  from: string
  content: string
  timestamp: number
  status: 'sent' | 'delivered' | 'read'
}

export const chatsApi = {
  list: (participant?: string) =>
    service.get<ApiAsyncChat[]>('/chats' + (participant ? `?participant=${encodeURIComponent(participant)}` : '')),

  getMessages: (chatId: string) =>
    service.get<ApiAsyncChatMessage[]>(`/chats/${chatId}/messages`),
}

// ─── Analytics API ──────────────────────────────────────────────────────

export const analyticsApi = {
  tokens: () =>
      service.get<TokenStats>('/analytics/tokens')
}

// ─── Health Check ───────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok'
}

export async function getServiceHealth() {
  return service.get<HealthStatus>('/health')
}

export async function checkHealth(): Promise<boolean> {
  try {
    await getServiceHealth()
    return true
  } catch {
    return false
  }
}
