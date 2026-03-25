/**
 * @bcc/channel-http — API 类型定义
 *
 * 与 Web 前端 (packages/web) 共享数据形状。
 * Worker / Session / Message 均使用这些类型。
 */

// ─── Worker ────────────────────────────────────────────────────────────────────

/**
 * ApiWorkerCapabilities：Worker 能力配置（API 层轻量镜像，与 @bcc/foundation 保持结构一致）
 */
export interface ApiWorkerCapabilities {
  browser?: {
    headless?: boolean;
    timeout?: number;
    allowedUrls?: string[];
    screenshotDir?: string;
    viewportWidth?: number;
    viewportHeight?: number;
  } | boolean;
  memory?: {
    episodic?: boolean;
    longTerm?: boolean;
    contextWindow?: number;
  } | boolean;
  soul?: {
    file?: string;
    userContext?: string;
  } | boolean;
  task?: boolean;
  reflection?: boolean;
  skillEvolution?: boolean;
  proactivity?: {
    heartbeat?: string;
    routine?: Array<'checkInbox' | 'reviewTasks' | 'planDay' | 'notify'>;
  } | boolean;
}

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
  status: 'online' | 'idle' | 'offline' | 'busy';
  /** 自定义工作空间路径（绝对路径，未设置时默认 ~/.bcc/workspaces/{id}） */
  workspace?: string;
  /** Worker 可选能力配置（browser / memory / soul 等） */
  capabilities?: ApiWorkerCapabilities;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface WorkspaceFileEntry {
  name: string;
  path: string;    // 相对于工作空间根目录
  size: number;
  mtime: number;
  isDir: boolean;
}

export interface WorkspaceInfo {
  workspaceDir: string;
  sharedDir:    string;
  files:        WorkspaceFileEntry[];
  sharedFiles:  WorkspaceFileEntry[];
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
  /** LLM 生成的会话摘要，供跨会话上下文注入 */
  summary?: string;
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
  insecure?: boolean;
  noProxy?: string;
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

// ─── Tools ────────────────────────────────────────────────────────────────────

/** 工具分类 */
export type ToolCategory = 'builtin' | 'browser' | 'user';

/** 工具输入参数 Schema（JSON Schema 子集） */
export interface ApiToolInputParam {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
  properties?: Record<string, ApiToolInputParam>;
  required?: string[];
}

/** 工具条目（用于列表展示和详情） */
export interface ApiToolEntry {
  /** 工具唯一标识（命名空间形式，例如 "workspace-read"、"browser_navigate"） */
  id: string;
  /** 工具展示名 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具分类 */
  category: ToolCategory;
  /** 输入参数定义（JSON Schema properties） */
  inputParams?: Record<string, ApiToolInputParam>;
  /** 必填参数列表 */
  requiredParams?: string[];
  /** 是否需要额外配置才能使用（如浏览器工具需要 capabilities.browser） */
  requiresCapability?: string;
}

/** 用户自定义工具（Webhook 类型） */
export interface UserToolConfig {
  /** 工具 ID（唯一，用户指定，小写字母/数字/下划线） */
  id: string;
  /** 展示名 */
  name: string;
  /** 描述 */
  description: string;
  /** Webhook URL */
  webhookUrl: string;
  /** HTTP 方法（默认 POST） */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 输入参数定义（JSON Schema properties） */
  inputParams?: Record<string, ApiToolInputParam>;
  /** 必填参数列表 */
  requiredParams?: string[];
}

/** GET /api/tools 响应体 */
export interface ApiToolsResponse {
  builtin: ApiToolEntry[];
  browser: ApiToolEntry[];
  user: UserToolConfig[];
}

// ─── SSE 事件 ─────────────────────────────────────────────────────────────────

export type SseEvent =
  | { event: 'chunk';       data: { text: string } }
  | { event: 'speaker';     data: { workerId: string; workerName: string } }
  | { event: 'tool_call';   data: { tool: string; input: Record<string, unknown> } }
  | { event: 'tool_result'; data: { tool: string; result: string; isError: boolean } }
  | { event: 'done';        data: { tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } } }
  | { event: 'error';       data: { message: string } };
