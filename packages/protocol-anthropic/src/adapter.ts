import Anthropic from '@anthropic-ai/sdk';
import {
  ModelError,
  type CompletionParams,
  type Message,
  type ModelInfo,
  type StreamChunk,
  type ToolDefinition,
} from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';

export interface AnthropicAdapterOptions {
  /**
   * 实例名称，用作适配器 ID（对应配置文件中的 instance.id）。
   * 例如："claude"、"claude-pro"
   */
  name: string;

  apiKey?: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicAdapter implements ModelAdapter {
  readonly id: string;
  readonly info: ModelInfo;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(options: AnthropicAdapterOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.id = options.name;
    this.info = {
      id: this.id,
      provider: 'anthropic',
      contextWindow: 200_000,
      supportStreaming: true,
      supportTools: true,
    };
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env['ANTHROPIC_API_KEY'],
      ...(options.baseURL && { baseURL: options.baseURL }),
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
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: maxTokens ?? this.maxTokens,
        ...(system !== undefined && { system }),
        messages: this.convertMessages(messages),
        ...(tools && { tools: this.convertTools(tools) }),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      const assistantMsg: Message = {
        role: 'assistant',
        content: final.content.map((block: Anthropic.ContentBlock) => {
          if (block.type === 'text') return { type: 'text' as const, text: block.text };
          const tb = block as Anthropic.ToolUseBlock;
          return {
            type: 'tool_use' as const,
            id: tb.id,
            name: tb.name,
            input: tb.input as Record<string, unknown>,
          };
        }),
      };
      const tokenUsage = {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        totalTokens: final.usage.input_tokens + final.usage.output_tokens,
      };
      yield { type: 'done', message: assistantMsg, tokenUsage };
    } catch (err) {
      throw new ModelError(
        `${this.id} stream failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.models.retrieve(this.model);
      return true;
    } catch {
      return false;
    }
  }

  // ─── 格式转换 ────────────────────────────────────────────────────────────────

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map(msg => {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      if (typeof msg.content === 'string') {
        return { role, content: msg.content };
      }
      const content = Array.isArray(msg.content) ? msg.content : [msg.content];
      return {
        role,
        content: content.map(c => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text };
          if (c.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: c.id,
              name: c.name,
              input: c.input,
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: c.tool_use_id,
            content: c.content,
          };
        }),
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}
