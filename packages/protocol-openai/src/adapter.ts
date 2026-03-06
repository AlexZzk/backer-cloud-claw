import OpenAI from 'openai';
import {
  ModelError,
  type CompletionParams,
  type Message,
  type ModelInfo,
  type StreamChunk,
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
