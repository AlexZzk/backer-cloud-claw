// ─── 消息角色 ────────────────────────────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system' | 'tool';

// ─── 消息内容 ────────────────────────────────────────────────────────────────

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

// ─── 消息 ────────────────────────────────────────────────────────────────────

export interface Message {
  role: Role;
  content: MessageContent | MessageContent[] | string;
}

// 工具函数：从 Message 中提取纯文本
export function extractText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text)
      .join('');
  }
  if (msg.content.type === 'text') return msg.content.text;
  return '';
}

// ─── Token 用量 ───────────────────────────────────────────────────────────────

/**
 * TokenUsage：单次模型调用的 Token 消耗。
 * 由协议适配器从 API 响应中提取，随 done StreamChunk 一起返回。
 * AgentEngine 跨迭代累积后在最终 done AgentChunk 中汇总上报。
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ─── 模型流式输出 ─────────────────────────────────────────────────────────────

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'done';
  text?: string;
  tool?: ToolUseContent;
  /** done 时携带完整回复 */
  message?: Message;
  /** done 时携带本次调用的 token 用量（由适配器填充） */
  tokenUsage?: TokenUsage;
}

// ─── 模型参数 ─────────────────────────────────────────────────────────────────

export interface CompletionParams {
  messages: Message[];
  system?: string | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  tools?: ToolDefinition[] | undefined;
}

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── 模型信息 ─────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  supportStreaming: boolean;
  supportTools: boolean;
}

// ─── Agent 输出 chunk（含工具调用事件）────────────────────────────────────────

/** 工具调用事件：Agent 即将执行某个工具 */
export interface ToolCallChunk {
  type: 'tool_call';
  tool: string;
  input: Record<string, unknown>;
}

/** 工具结果事件：执行完成后的输出 */
export interface ToolResultChunk {
  type: 'tool_result';
  tool: string;
  result: string;
  isError: boolean;
}

/**
 * AgentChunk：AgentEngine.stream() 产生的事件类型。
 * 是 StreamChunk 的超集，额外包含工具调用/结果事件。
 */
export type AgentChunk = StreamChunk | ToolCallChunk | ToolResultChunk;

// ─── 工具（可被模型调用的函数）──────────────────────────────────────────────

/**
 * Tool：一个可被模型调用的工具。
 *
 * definition 告诉模型"这个工具是什么、接受什么参数"；
 * handler    是实际执行逻辑，返回字符串结果（模型可读）。
 */
export interface Tool {
  definition: ToolDefinition;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

// ─── Agent 统一接口 ──────────────────────────────────────────────────────────

/**
 * AgentInterface：ChatSession 与 AgentEngine 共同实现的接口。
 * CliChannel 和 REPL 针对此接口编程，与底层实现解耦。
 */
export interface AgentInterface {
  /** 流式输出（含工具调用事件） */
  stream(userInput: string): AsyncIterable<AgentChunk>;

  /** 当前使用的模型 ID */
  readonly currentModel: string;

  /** 列出所有可用模型 */
  listModels(): string[];

  /** 获取当前会话历史 */
  getHistory(): Message[];

  /** 清空历史 */
  clearHistory(): void;

  /** 导出历史文本（调试用） */
  dumpHistory(): string;

  /** 切换模型（需要底层支持 ModelRouter） */
  switchModel?(modelId: string): void;

  /** 手动持久化（不提供 memory 则为空操作） */
  persist?(): Promise<void>;
}

// ─── Org 层核心类型（Worker / Company / Thread 体系）────────────────────────

/**
 * WorkerProfile：Worker（AI 员工）的身份信息。
 *
 * 一个 Worker = 一个模型实例 + 身份 + 技能。
 * 例如：Claude + 「后端工程师」+ [「编写代码」,「代码审查」]
 *      Qwen  + 「文案策划」  + [「文本生成」,「内容润色」]
 */
export interface WorkerProfile {
  /** 唯一标识，跨线程全局唯一 */
  id: string;
  /** 显示名称，例如"后端工程师 Claude" */
  name: string;
  /** 职责角色，注入 system prompt，例如"你是一位专注于后端开发的工程师" */
  role: string;
  /** 技能标签（元数据），例如 ["编写代码", "代码审查", "架构设计"] */
  skills: string[];
  /** 详细描述，供其他 Worker 了解该员工的能力边界 */
  description: string;
  /** 引用的模型适配器 ID，例如 "claude"、"qwen-plus" */
  modelId: string;
}

/**
 * OrgMessage：组织内参与者之间传递的消息。
 *
 * 与 LLM 协议层的 Message（role/content）不同，
 * OrgMessage 是组织层面的信息载体，携带发件人、收件人、线索 ID 和 token 消耗。
 */
export interface OrgMessage {
  /** 消息唯一 ID */
  id: string;
  /** 所属 Thread ID */
  threadId: string;
  /** 发件人 Participant ID（'user' 表示外部用户输入） */
  from: string;
  /** 收件人 Participant ID，或 ID 数组（群发） */
  to: string | string[];
  /** 消息正文 */
  content: string;
  /** 发送时间戳（ms） */
  timestamp: number;
  /** 本条消息产生的 token 消耗（Worker 回复时填充） */
  tokenUsage?: TokenUsage;
  /** 扩展元数据（附件、引用消息 ID 等） */
  metadata?: Record<string, unknown>;
}

/**
 * OrgThread：一次持续对话的消息线索。
 *
 * 可以是用户与单个 Worker 的 1-1 对话，
 * 也可以是多个 Worker 之间的群组讨论（如 PM→PjM→Arch 工作流）。
 */
export interface OrgThread {
  id: string;
  /** 线索主题，例如"实现用户登录功能" */
  topic: string;
  /** 参与者 ID 列表 */
  participants: string[];
  status: 'active' | 'closed';
  createdAt: number;
  closedAt?: number;
}

/**
 * Participant：Worker 和 Company 共享的接口（Composite 模式）。
 *
 * Company 和 Worker 都是 Participant，Company 可以作为更大组织的成员，
 * 实现无限嵌套的组织结构。
 */
export interface Participant {
  readonly id: string;
  readonly profile: WorkerProfile;
  /**
   * 接收并处理一条 OrgMessage，返回回复消息（或 null 表示无需回复）。
   * Worker 实现中会触发 LLM 推理；Company 实现中会路由给合适的成员。
   */
  receive(message: OrgMessage): Promise<OrgMessage | null>;
  /** 返回该参与者的能力自述（供其他 Worker 了解） */
  describe(): string;
}

/**
 * OrgEvent：组织层面的可观测事件流。
 *
 * 由 Worker / Company 在关键操作时 emit，管理后台订阅这些事件
 * 以实现实时可视化（群聊界面、token 消耗统计等）。
 */
export type OrgEvent =
  | { type: 'message:received'; workerId: string; message: OrgMessage }
  | { type: 'message:sent'; workerId: string; message: OrgMessage }
  | { type: 'worker:thinking'; workerId: string; threadId: string }
  | { type: 'worker:done'; workerId: string; threadId: string; tokenUsage: TokenUsage }
  | { type: 'thread:opened'; thread: OrgThread }
  | { type: 'thread:closed'; thread: OrgThread; totalTokens: number };

// ─── 情节记忆（Episodic Memory）────────────────────────────────────────────────

/**
 * Episode：一次完整会话的摘要条目。
 *
 * 由 EpisodeGenerator 在会话结束后自动生成，
 * 供下次会话开始时注入 Worker 的 system prompt，实现跨会话记忆。
 */
export interface Episode {
  /** 条目唯一 ID */
  id: string;
  /** 所属 Worker ID */
  workerId: string;
  /** 来源会话 ID（对应 MemoryStore 的 sessionId） */
  sessionId: string;
  /** LLM 生成的自然语言摘要 */
  summary: string;
  /** 关键结论/决策列表（提取自对话） */
  keyPoints: string[];
  /** 本次会话的消息轮数（user + assistant 各算 1 轮） */
  turnCount: number;
  /** 生成时间（ms 时间戳） */
  createdAt: number;
}

/**
 * EpisodicStore：情节记忆存储后端接口。
 *
 * 设计原则：接口与实现分离，可插拔。
 *   - 默认实现：FileEpisodicStore（@bcc/memory-episodic，存文件）
 *   - 未来可替换为数据库实现，不改业务代码
 */
export interface EpisodicStore {
  /** 追加一条新情节记忆 */
  append(episode: Episode): Promise<void>;
  /** 返回指定 Worker 最近 N 条记忆（按时间倒序） */
  recent(workerId: string, limit: number): Promise<Episode[]>;
  /** 清空指定 Worker 的全部情节记忆 */
  clear(workerId: string): Promise<void>;
}
