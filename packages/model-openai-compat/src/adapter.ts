import OpenAI from 'openai';
import {
  ModelError,
  type CompletionParams,
  type Message,
  type ModelInfo,
  type StreamChunk,
} from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';

export interface OpenAICompatAdapterOptions {
  /**
   * 适配器的唯一名称，用于在 ModelRouter 中标识。
   * 例如："local-llama"、"my-proxy-gpt4"
   */
  name: string;

  /** API Key（部分私有部署可随意填写，如 "none"） */
  apiKey?: string;

  /** OpenAI 兼容 API 的 Base URL，例如 http://localhost:11434/v1 */
  baseUrl: string;

  /** 模型名称，例如 "llama3"、"qwen2.5-72b-instruct" */
  model: string;

  /** 单次最大生成 token 数（默认 8192） */
  maxTokens?: number;

  /**
   * 上下文窗口大小（tokens，默认 128000）。
   * 仅作为元信息展示，不影响请求参数。
   */
  contextWindow?: number;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_CONTEXT_WINDOW = 128_000;

export class OpenAICompatAdapter implements ModelAdapter {
  readonly id: string;
  readonly info: ModelInfo;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: OpenAICompatAdapterOptions) {
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.id = `custom:${options.name}`;
    this.info = {
      id: this.id,
      provider: 'custom',
      contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      supportStreaming: true,
      supportTools: false, // 工具支持取决于后端，保守设为 false
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
    const { messages, system, maxTokens } = params;

    try {
      const openaiMessages = this.convertMessages(messages, system);

      const stream = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens ?? this.maxTokens,
        messages: openaiMessages,
        stream: true,
      });

      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          yield { type: 'text', text: delta };
        }
      }

      const assistantMsg: Message = { role: 'assistant', content: fullText };
      yield { type: 'done', message: assistantMsg };
    } catch (err) {
      throw new ModelError(
        `${this.id} stream failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      // 发送一个极短的请求来验证连通性
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

  private convertMessages(
    messages: Message[],
    system?: string,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (system) {
      result.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter(c => c.type === 'text')
                .map(c => (c.type === 'text' ? c.text : ''))
                .join('')
            : msg.content.type === 'text'
              ? msg.content.text
              : '';

      if (msg.role === 'user') {
        result.push({ role: 'user', content });
      } else if (msg.role === 'assistant') {
        result.push({ role: 'assistant', content });
      }
    }

    return result;
  }
}
