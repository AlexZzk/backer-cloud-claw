import type { CompletionParams, ModelInfo, StreamChunk } from '@bcc/foundation';

/**
 * 所有模型适配器必须实现此接口。
 * 每个适配器代表一个具体的模型提供商（Claude / OpenAI / DeepSeek 等）。
 */
export interface ModelAdapter {
  /** 适配器唯一标识，例如 "claude-sonnet-4-5" */
  readonly id: string;

  /** 模型元信息 */
  readonly info: ModelInfo;

  /**
   * 流式生成回复。
   * 调用方通过 `for await` 消费每个 chunk，最后一个 chunk type 为 'done'。
   */
  stream(params: CompletionParams): AsyncIterable<StreamChunk>;

  /**
   * 非流式生成（等待完整回复）。
   * 默认实现可基于 stream() 封装，适配器可选择覆写以提升性能。
   */
  complete(params: CompletionParams): Promise<string>;

  /** 检查连通性（可选，用于故障检测） */
  ping?(): Promise<boolean>;
}
