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

  /**
   * 是否启用 Prompt Caching（Anthropic 专有特性）。
   *
   * 启用后，system prompt 会被标记为 cache_control: ephemeral，
   * 命中缓存时输入 token 成本降低 90%，延迟降低 85%。
   * 适合 system prompt 较长且重复调用频繁的场景（如 Worker 的 SOUL.md + MEMORY.md）。
   *
   * 默认 true（自动启用，仅在 Anthropic 官方 API 有效）。
   */
  promptCaching?: boolean;
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicAdapter implements ModelAdapter {
  readonly id: string;
  readonly info: ModelInfo;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private promptCaching: boolean;

  constructor(options: AnthropicAdapterOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.id = options.name;
    this.promptCaching = options.promptCaching ?? true;
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

    type StreamParams = Parameters<typeof this.client.messages.stream>[0];
    const baseParams: StreamParams = {
      model: this.model,
      max_tokens: maxTokens ?? this.maxTokens,
      messages: this.convertMessages(messages),
      ...(tools && { tools: this.convertTools(tools) }),
    };

    // Prompt Caching：将 system prompt 标记为 ephemeral，命中缓存可节省 90% 输入 token
    const streamParams: StreamParams = system !== undefined
      ? {
          ...baseParams,
          system: this.promptCaching
            ? [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }]
            : system,
        }
      : baseParams;

    try {
      const stream = await this.client.messages.stream(streamParams);

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
      // cache_read_input_tokens：命中缓存的 token 数（成本仅为正常的 10%）
      // cache_creation_input_tokens：首次写入缓存的 token 数（成本为正常的 125%）
      const usage = final.usage as typeof final.usage & {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      const effectiveInputTokens = (usage.input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0);
      const tokenUsage = {
        inputTokens: effectiveInputTokens,
        outputTokens: final.usage.output_tokens,
        totalTokens: effectiveInputTokens + final.usage.output_tokens,
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
