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
