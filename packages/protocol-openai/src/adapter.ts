import OpenAI from 'openai';
import {
  ModelError,
  type CompletionParams,
  type Message,
  type MessageContent,
  type ModelInfo,
  type StreamChunk,
  type TextContent,
  type ToolDefinition,
  type ToolResultContent,
  type ToolUseContent,
} from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';

export interface OpenAIAdapterOptions {
  /**
   * 实例名称，用作适配器 ID（对应配置文件中的 instance.id）。
   * 例如："deepseek"、"bailian"、"my-llama"
   */
  name: string;

  /** API Key（私有部署可填 "none"） */
  apiKey?: string;

  /**
   * OpenAI 兼容 API 的 Base URL。
   * 例如：https://api.deepseek.com/v1、http://localhost:11434/v1
   */
  baseUrl: string;

  /**
   * 模型名称。
   * 例如："deepseek-chat"、"qwen-plus"、"llama3"
   */
  model: string;

  /** 单次最大生成 token 数（默认 8192） */
  maxTokens?: number;

  /** 上下文窗口大小（token，默认 128000），仅作元信息展示 */
  contextWindow?: number;

  /**
   * 该端点是否支持工具调用（默认 true）。
   * 私有部署若不支持 function calling，请设为 false。
   */
  supportTools?: boolean;

  /**
   * ModelInfo 中展示的提供商标识（默认 'openai'）。
   * 例如："deepseek"、"bailian"、"custom"
   */
  provider?: string;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_CONTEXT_WINDOW = 128_000;

export class OpenAIAdapter implements ModelAdapter {
  readonly id: string;
  readonly info: ModelInfo;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: OpenAIAdapterOptions) {
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.id = options.name;
    this.info = {
      id: this.id,
      provider: options.provider ?? 'openai',
      contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      supportStreaming: true,
      supportTools: options.supportTools ?? true,
    };
    this.client = new OpenAI({
      apiKey: options.apiKey ?? 'none',
      baseURL: options.baseUrl,
    });
  }

  async complete(params: CompletionParams): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.stream(params)) {
      if (chunk.type === 'text' && chunk.text) chunks.push(chunk.text);
    }
    return chunks.join('');
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    const { messages, system, maxTokens, tools } = params;

    try {
      const openaiMessages = this.convertMessages(messages, system);
      const openaiTools = tools?.length ? this.convertTools(tools) : undefined;

      const stream = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens ?? this.maxTokens,
        messages: openaiMessages,
        ...(openaiTools && { tools: openaiTools }),
        stream: true,
      });

      let fullText = '';
      // index → 累积的工具调用数据（OpenAI 流式分片按 index 归并）
      const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // 文本内容
        if (delta.content) {
          fullText += delta.content;
          yield { type: 'text', text: delta.content };
        }

        // 工具调用分片（按 index 归并 id / name / arguments）
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallAccum.has(tc.index)) {
              toolCallAccum.set(tc.index, { id: '', name: '', arguments: '' });
            }
            const entry = toolCallAccum.get(tc.index)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }
      }

      // 构建 MessageContent 数组（与 Anthropic 适配器格式一致，AgentEngine 可直接读取）
      const content: MessageContent[] = [];
      if (fullText) content.push({ type: 'text', text: fullText });

      const sortedToolCalls = [...toolCallAccum.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, tc]) => tc);

      for (const tc of sortedToolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.arguments) as Record<string, unknown>;
        } catch {
          input = { _raw: tc.arguments };
        }
        const toolUse: ToolUseContent = { type: 'tool_use', id: tc.id, name: tc.name, input };
        content.push(toolUse);
      }

      // 纯文本回复保持 string 格式；含工具调用时使用 MessageContent[]
      const firstItem = content[0];
      const assistantContent: Message['content'] =
        content.length === 0
          ? ''
          : content.length === 1 && firstItem?.type === 'text'
            ? firstItem.text
            : content;

      yield { type: 'done', message: { role: 'assistant', content: assistantContent } };
    } catch (err) {
      throw new ModelError(
        `${this.id} stream failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将内部 Message[] 转为 OpenAI ChatCompletionMessageParam[]。
   *
   * 格式映射：
   *   内部 tool_use（assistant content） → OpenAI tool_calls
   *   内部 tool_result（user content）   → OpenAI role:'tool' 消息
   */
  private convertMessages(
    messages: Message[],
    system?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (system) {
      result.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          const toolResults = msg.content.filter(
            (c): c is ToolResultContent => c.type === 'tool_result',
          );
          const textStr = msg.content
            .filter((c): c is TextContent => c.type === 'text')
            .map(c => c.text)
            .join('');

          // tool_result 条目 → 独立的 role:'tool' 消息
          for (const tr of toolResults) {
            result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
          }
          // 同消息中若还有文本，作为 user 消息附在后面
          if (textStr) result.push({ role: 'user', content: textStr });
        } else if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else if (msg.content.type === 'text') {
          result.push({ role: 'user', content: msg.content.text });
        } else if (msg.content.type === 'tool_result') {
          // 单条 tool_result（边界情况）
          result.push({
            role: 'tool',
            tool_call_id: msg.content.tool_use_id,
            content: msg.content.content,
          });
        }
      } else if (msg.role === 'assistant') {
        let text = '';
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c.type === 'text') {
              text += c.text;
            } else if (c.type === 'tool_use') {
              toolCalls.push({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              });
            }
          }
        } else if (msg.content.type === 'text') {
          text = msg.content.text;
        } else if (msg.content.type === 'tool_use') {
          const c = msg.content as ToolUseContent;
          toolCalls.push({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          });
        }

        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: text || null,
        };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      }
    }

    return result;
  }

  /** 将内部 ToolDefinition[] 转为 OpenAI ChatCompletionTool[] */
  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));
  }
}
