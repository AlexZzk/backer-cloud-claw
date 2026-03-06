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

// ─── 模型流式输出 ─────────────────────────────────────────────────────────────

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'done';
  text?: string;
  tool?: ToolUseContent;
  // done 时携带完整回复
  message?: Message;
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
