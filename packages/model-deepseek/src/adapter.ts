import OpenAI from 'openai';
import {
  ModelError,
  type CompletionParams,
  type Message,
  type ModelInfo,
  type StreamChunk,
} from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';

export interface DeepSeekAdapterOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_MAX_TOKENS = 8192;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

export class DeepSeekAdapter implements ModelAdapter {
  readonly id: string;
  readonly info: ModelInfo;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: DeepSeekAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.id = `deepseek:${this.model}`;
    this.info = {
      id: this.id,
      provider: 'deepseek',
      contextWindow: 64_000,
      supportStreaming: true,
      supportTools: true,
    };
    // DeepSeek 兼容 OpenAI API 格式，直接复用 openai SDK
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env['DEEPSEEK_API_KEY'],
      baseURL: DEEPSEEK_BASE_URL,
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

      const assistantMsg: Message = {
        role: 'assistant',
        content: fullText,
      };
      yield { type: 'done', message: assistantMsg };
    } catch (err) {
      throw new ModelError(
        `DeepSeek stream failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  // ─── 格式转换 ────────────────────────────────────────────────────────────────

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
