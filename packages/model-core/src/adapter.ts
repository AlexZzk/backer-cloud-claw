import type { CompletionParams, ModelInfo, StreamChunk } from '@bcc/foundation';

/**
 * RoutableModel：支持多模型路由的适配器接口（由 ModelRouter 实现）。
 *
 * 使用 isRoutableModel() 类型守卫代替 instanceof ModelRouter，
 * 使上层模块（ChatSession、AgentEngine）无需直接依赖具体的 ModelRouter 类。
 */
export interface RoutableModel {
  readonly currentModelId: string;
  switchTo(modelId: string): void;
  listModels(): ModelInfo[];
}

/**
 * 判断一个 ModelAdapter 是否实现了 RoutableModel 接口。
 * 通过检查方法存在性而非 instanceof，对扩展保持开放。
 */
export function isRoutableModel(m: unknown): m is RoutableModel {
  return (
    typeof m === 'object' &&
    m !== null &&
    'currentModelId' in m &&
    'switchTo' in m &&
    'listModels' in m &&
    typeof (m as Record<string, unknown>)['switchTo'] === 'function'
  );
}

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
