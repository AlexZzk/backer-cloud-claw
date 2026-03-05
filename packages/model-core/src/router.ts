import {
  AllModelsFailedError,
  ModelUnavailableError,
  type CompletionParams,
  type StreamChunk,
  type ModelInfo,
} from '@bcc/foundation';
import type { ModelAdapter } from './adapter.js';

export interface ModelEntry {
  adapter: ModelAdapter;
  /** 是否仅作为故障转移备用（不参与手动切换的默认选择） */
  fallback?: boolean;
  /** 权重，数字越小优先级越高（默认 0） */
  priority?: number;
}

export interface ModelRouterOptions {
  /** 故障转移：主模型报错时自动尝试下一个 */
  enableFailover?: boolean;
  /** 最大重试次数（故障转移链的长度上限） */
  maxRetries?: number;
}

/**
 * ModelRouter：管理多个模型适配器，提供：
 *   A. 故障转移：主模型不可用时自动切换备用
 *   B. 手动切换：运行时指定使用哪个模型
 */
export class ModelRouter implements ModelAdapter {
  readonly id = 'model-router';
  private entries: ModelEntry[] = [];
  private activeId: string | null = null;
  private options: Required<ModelRouterOptions>;

  constructor(options: ModelRouterOptions = {}) {
    this.options = {
      enableFailover: options.enableFailover ?? true,
      maxRetries: options.maxRetries ?? 3,
    };
  }

  // ─── 注册模型 ───────────────────────────────────────────────────────────────

  register(adapter: ModelAdapter, opts: Omit<ModelEntry, 'adapter'> = {}): this {
    this.entries.push({ adapter, ...opts });
    // 按优先级排序
    this.entries.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    // 第一个非 fallback 模型为默认 active
    if (this.activeId === null && !opts.fallback) {
      this.activeId = adapter.id;
    }
    return this;
  }

  // ─── 手动切换 (场景 B) ───────────────────────────────────────────────────────

  switchTo(modelId: string): void {
    const found = this.entries.find(e => e.adapter.id === modelId);
    if (!found) {
      throw new ModelUnavailableError(modelId);
    }
    this.activeId = modelId;
  }

  get currentModelId(): string {
    return this.activeId ?? this.entries[0]?.adapter.id ?? 'none';
  }

  listModels(): ModelInfo[] {
    return this.entries.map(e => e.adapter.info);
  }

  // ─── ModelAdapter 接口实现 ──────────────────────────────────────────────────

  get info(): ModelInfo {
    return this.getActive().info;
  }

  async complete(params: CompletionParams): Promise<string> {
    const chain = this.buildChain();
    const errors: Error[] = [];

    for (const entry of chain) {
      try {
        return await entry.adapter.complete(params);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        if (!this.options.enableFailover) break;
      }
    }

    throw new AllModelsFailedError(errors);
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    const chain = this.buildChain();
    const errors: Error[] = [];

    for (const entry of chain) {
      try {
        yield* entry.adapter.stream(params);
        return;
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        if (!this.options.enableFailover) break;
      }
    }

    throw new AllModelsFailedError(errors);
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private getActive(): ModelAdapter {
    const entry = this.entries.find(e => e.adapter.id === this.activeId)
      ?? this.entries[0];
    if (!entry) throw new ModelUnavailableError('(none)');
    return entry.adapter;
  }

  /**
   * 构建故障转移链：active 模型在首位，其余按优先级追加
   */
  private buildChain(): ModelEntry[] {
    const active = this.entries.find(e => e.adapter.id === this.activeId);
    const rest = this.entries.filter(e => e.adapter.id !== this.activeId);
    const chain = active ? [active, ...rest] : [...this.entries];
    return chain.slice(0, this.options.maxRetries);
  }
}
