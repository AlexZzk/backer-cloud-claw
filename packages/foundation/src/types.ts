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
  /** 可选：心跳/收件箱审视用的轻量模型 ID（比主模型便宜） */
  reviewModelId?: string;
  /**
   * Worker 特权等级（默认 'normal'）。
   * auditor 级别有特殊限制：不允许开启 reflection / skillEvolution。
   */
  privilegeLevel?: WorkerPrivilegeLevel;
  /**
   * 可选能力配置。未设置任何能力时，Worker 仅具备 Base Layer 能力
   * （身份 + 大脑 + 通信 + 状态机 + 可观测性）。
   */
  capabilities?: WorkerCapabilityConfig;
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
  | { type: 'thread:closed'; thread: OrgThread; totalTokens: number }
  // ─── Chat 异步通信事件 ───────────────────────────────────────────────────────
  | { type: 'chat:message:sent'; chatId: string; message: ChatMessage }
  | { type: 'chat:message:received'; workerId: string; chatId: string; message: ChatMessage }
  | { type: 'chat:opened'; chat: Chat }
  | { type: 'chat:archived'; chatId: string }
  // ─── Task 任务事件 ────────────────────────────────────────────────────────────
  | { type: 'task:created'; task: WorkerTask }
  | { type: 'task:updated'; task: WorkerTask; previousStatus: TaskStatus }
  | { type: 'task:completed'; task: WorkerTask }
  // ─── Worker 定期审视事件 ──────────────────────────────────────────────────────
  | { type: 'worker:inbox:checked'; workerId: string; pendingCount: number }
  | { type: 'worker:tasks:reviewed'; workerId: string; taskSummary: { todo: number; inProgress: number; done: number } }
  // ─── Worker 生命周期状态变化 ──────────────────────────────────────────────────
  | { type: 'worker:state:changed'; workerId: string; previousState: WorkerLifecycleState; newState: WorkerLifecycleState; timestamp: number };

// ─── Chat（异步会话通信系统）──────────────────────────────────────────────────

/**
 * ChatType：会话类型。
 * - direct：两人私聊（Worker ↔ Worker 或 User ↔ Worker）
 * - group：多人群聊
 */
export type ChatType = 'direct' | 'group';

/** ChatStatus：会话状态。 */
export type ChatStatus = 'active' | 'archived';

/**
 * Chat：Worker 之间（或 User 与 Worker 之间）的聊天会话。
 *
 * 类比飞书/微信的"聊天窗口"：
 * - 发送消息是异步的，发送方不需要等待接收方回复
 * - 每条消息都被持久化存档
 * - Worker 定期检查自己的会话，处理未读消息
 */
export interface Chat {
  /** 会话唯一 ID */
  id: string;
  type: ChatType;
  /** 参与者 ID 列表（Worker ID 或 'user'） */
  participants: string[];
  /** 会话标题（群聊时有意义，私聊可选） */
  title?: string;
  status: ChatStatus;
  createdAt: number;
  updatedAt: number;
  /** 最后一条消息预览（UI 显示用） */
  lastMessage?: string;
  /**
   * 会话摘要（Token 优化用）。
   * 由 Worker 处理完消息后异步生成，供后续 processInbox() 注入上下文。
   * 有摘要时只需加载最近 N 条消息，无需加载完整历史，大幅减少 token。
   */
  summary?: string;
  /** 摘要最后更新时间戳（ms） */
  summaryUpdatedAt?: number;
}

/** ChatMessageStatus：消息送达状态。 */
export type ChatMessageStatus = 'sent' | 'delivered' | 'read';

/**
 * ChatMessage：聊天会话中的一条消息。
 *
 * 与 OrgMessage 的核心区别：
 * - OrgMessage 是同步请求-响应模型（调用方阻塞等待回复）
 * - ChatMessage 是异步留言模型（发完即可继续其他工作）
 */
export interface ChatMessage {
  /** 消息唯一 ID */
  id: string;
  /** 所属会话 ID */
  chatId: string;
  /** 发送方 ID（Worker ID 或 'user'） */
  from: string;
  /** 消息正文 */
  content: string;
  /** 发送时间戳（ms） */
  timestamp: number;
  status: ChatMessageStatus;
  /**
   * 已读参与者列表（每个参与者独立标记已读，解决多人群聊中"一人已读影响其他人"的问题）。
   * 新消息创建时为空数组，每个参与者调用 markRead 后将自己加入此列表。
   */
  readBy: string[];
  /** 引用回复的消息 ID（对某条消息的回复） */
  replyToId?: string;
  /** 关联的任务 ID（消息触发或完成了某个任务） */
  taskId?: string;
  /** token 消耗（Worker 生成消息时填充） */
  tokenUsage?: TokenUsage;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

// ─── WorkerTask（任务 / TodoList）────────────────────────────────────────────

/** TaskStatus：任务状态。 */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

/** TaskPriority：任务优先级。 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * WorkerTask：Worker 的待办任务条目。
 *
 * 任务可以由用户或其他 Worker 通过聊天消息创建，
 * Worker 定期审视自己的任务列表，按优先级处理。
 *
 * 设计思路（类比真实公司）：
 * - 用户/上级 Worker 通过消息指派任务
 * - Worker 自己可以拆解为子任务
 * - Worker 完成后更新状态，触发通知
 */
export interface WorkerTask {
  /** 任务唯一 ID */
  id: string;
  /** 负责此任务的 Worker ID */
  assignedTo: string;
  /** 创建此任务的 ID（Worker ID 或 'user'） */
  createdBy: string;
  /** 关联的聊天会话 ID（任务来源上下文） */
  chatId?: string;
  /** 触发创建此任务的消息 ID */
  messageId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
  /** 截止时间（可选） */
  dueAt?: number;
  /** 父任务 ID（子任务拆解场景） */
  parentTaskId?: string;
}

// ─── Extended OrgEvent（新增 Chat 和 Task 事件）───────────────────────────────

// OrgEvent 在下方扩展，此处仅做类型声明占位

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

// ─── Worker 生命周期与治理 ────────────────────────────────────────────────────

/**
 * WorkerLifecycleState：Worker 当前的运行状态。
 *
 * - idle       空闲，可立即处理消息
 * - processing 正在处理消息/任务（新消息会进入 Mailbox 队列）
 * - sleeping   主动休眠（仅心跳或外部唤醒可激活）
 * - blocked    等待审批（高危操作挂起，审批通过后继续）
 */
export type WorkerLifecycleState = 'idle' | 'processing' | 'sleeping' | 'blocked';

/**
 * WorkerPrivilegeLevel：Worker 的特权等级。
 *
 * - normal   普通 Worker，只能执行白名单工具
 * - elevated 高级 Worker，可自主审批低风险申请
 * - auditor  审核员，可审批中/高风险，上报 Admin；不得开启 reflection/skillEvolution
 */
export type WorkerPrivilegeLevel = 'normal' | 'elevated' | 'auditor';

// ─── 能力插件配置 ─────────────────────────────────────────────────────────────

/** 主动性（Proactivity）配置。 */
export interface ProactivityCapabilityConfig {
  /** Cron 表达式，定时心跳唤醒（如 "0 9 * * *"） */
  heartbeat?: string;
  /** 唤醒后执行的晨检步骤（顺序执行） */
  routine?: Array<'checkInbox' | 'reviewTasks' | 'planDay' | 'notify'>;
}

/** 记忆（Memory）能力配置。 */
export interface MemoryCapabilityConfig {
  /** 开启情节记忆（每次对话结束后自动摘要） */
  episodic?: boolean;
  /** 开启长期记忆（MEMORY.md 精华提炼；依赖 episodic） */
  longTerm?: boolean;
  /** 启动时注入最近 N 条情节摘要（默认 10） */
  contextWindow?: number;
  /** 提炼长期记忆的 Cron 表达式（如 "0 23 * * *"） */
  consolidateInterval?: string;
}

/** 灵魂（Soul）能力配置。 */
export interface SoulCapabilityConfig {
  /** SOUL.md 文件路径（相对于 config 目录或绝对路径） */
  file?: string;
  /** USER.md 文件路径（记录用户/雇主背景） */
  userContext?: string;
}

/** 反思（Reflection）能力配置。 */
export interface ReflectionCapabilityConfig {
  /** 任务结束后自主反思（依赖 memory.episodic） */
  selfReflect?: boolean;
  /** 接受外部反馈并决策是否采纳（更新 SOUL.md） */
  feedbackInbox?: boolean;
}

/** 技能进化（SkillEvolution）能力配置。 */
export interface SkillEvolutionCapabilityConfig {
  /** 允许生成私有技能（仅本 Worker 可见） */
  privateSkills?: boolean;
  /** 允许向 Admin 提建议，申请将私有技能晋升为团队技能 */
  canShareRequest?: boolean;
}

/**
 * WorkerCapabilityConfig：Worker 可选能力的配置集合。
 *
 * 每项能力均可设为 `true`（使用默认配置）或具体配置对象。
 * 未设置或设为 `false` / `undefined` 表示禁用。
 *
 * 依赖关系（启动时自动校验）：
 *   memory.longTerm  →  memory.episodic
 *   reflection       →  memory.episodic
 *   skillEvolution   →  reflection
 *   proactivity.routine（包含 reviewTasks）  →  task
 */
export interface WorkerCapabilityConfig {
  /** 主动性：定时心跳 + 晨检流程 */
  proactivity?: ProactivityCapabilityConfig | boolean;
  /** 任务管理：TaskList + Scheduler */
  task?: boolean;
  /** 记忆体系：情节记忆 + 长期记忆 */
  memory?: MemoryCapabilityConfig | boolean;
  /** 灵魂/个性：SOUL.md 注入 system prompt */
  soul?: SoulCapabilityConfig | boolean;
  /** 反思：自主反思 + 接受外部反馈 */
  reflection?: ReflectionCapabilityConfig | boolean;
  /** 技能进化：私有技能 + 晋升申请 */
  skillEvolution?: SkillEvolutionCapabilityConfig | boolean;
}

// ─── 审计日志 ─────────────────────────────────────────────────────────────────

/**
 * AuditAction：审计日志中记录的操作类型。
 */
export type AuditAction =
  | 'message:received'    // 收到消息
  | 'message:sent'        // 发出消息
  | 'tool:called'         // 调用了一个工具
  | 'tool:result'         // 工具执行完成
  | 'inbox:checked'       // 收件箱审视完成
  | 'state:changed'       // 生命周期状态变化
  | 'approval:requested'; // 发起了一个审批申请

/**
 * AuditEntry：一条不可篡改的审计记录。
 *
 * 所有 Worker 的重要操作都会写入对应的 ~/.bcc/audit/{workerId}.jsonl 文件。
 */
export interface AuditEntry {
  /** 记录唯一 ID */
  id: string;
  /** 写入时间戳（ms） */
  timestamp: number;
  /** 操作归属的 Worker ID */
  workerId: string;
  /** 关联 Thread ID（同步通信路径） */
  threadId?: string;
  /** 关联 Chat ID（异步通信路径） */
  chatId?: string;
  /** 操作类型 */
  action: AuditAction;
  /** 操作详情（自由结构，记录关键参数） */
  details: Record<string, unknown>;
  /** 本次操作产生的 token 消耗（如有） */
  tokenUsage?: TokenUsage;
}
