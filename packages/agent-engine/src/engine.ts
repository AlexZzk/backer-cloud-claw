import {
  type AgentChunk,
  type AgentInterface,
  type MemoryStore,
  type Message,
  type TokenUsage,
  type ToolResultContent,
  type ToolUseContent,
  extractText,
} from '@bcc/foundation';
import { type ModelAdapter, isRoutableModel } from '@bcc/model-core';
import { loadContextFiles, mergeSystemPrompt } from './context.js';
import { ToolRegistry, type Tool } from './tool.js';
import { ContextCompactor, type CompactorOptions } from './compactor.js';

export interface AgentEngineOptions {
  /** 模型适配器或已配置的 ModelRouter */
  model: ModelAdapter;

  /**
   * 系统提示词（手动指定）。
   * 会与 contextFiles 加载的内容合并（contextFiles 在前）。
   */
  system?: string | undefined;

  /**
   * 上下文文件路径列表（AGENTS.md / SOUL.md 等）。
   * 内容自动前置到系统提示，文件不存在时忽略。
   */
  contextFiles?: string[] | undefined;

  /** 预注册工具列表 */
  tools?: Tool[] | undefined;

  /**
   * 工具调用循环的最大迭代次数。
   * 防止模型陷入无限工具循环。默认 10。
   */
  maxIterations?: number | undefined;

  /** 最大生成 token 数 */
  maxTokens?: number | undefined;

  /** 持久化存储后端（可选） */
  memory?: MemoryStore | undefined;

  /** 会话 ID，配合 memory 使用 */
  sessionId?: string | undefined;

  /**
   * Context 压缩配置（可选）。
   * 不提供时使用默认阈值（40 条消息触发压缩，保留最近 10 条）。
   * 设为 false 可完全禁用压缩。
   */
  compaction?: CompactorOptions | false | undefined;
}

/**
 * AgentEngine：核心 Agent 执行引擎。
 *
 * 在 ChatSession 的多轮对话基础上，增加：
 *   - 工具调用循环（Tool Use → 执行 → 结果回传 → 继续生成）
 *   - 上下文文件加载（AGENTS.md / SOUL.md）
 *   - 工具注册与执行管理
 *   - 可选持久化（任意 MemoryStore 实现）
 *
 * 实现了 AgentInterface，可直接传给 CliChannel 使用。
 *
 * 基本用法：
 *   const engine = await AgentEngine.create({
 *     model: new ClaudeAdapter(),
 *     tools: [calculatorTool],
 *   });
 *   const text = await engine.chat('2的10次方是多少？');
 */
export class AgentEngine implements AgentInterface {
  private model: ModelAdapter;
  private registry: ToolRegistry;
  private history: Message[];
  private resolvedSystem: string | undefined;
  private maxIterations: number;
  private maxTokens: number | undefined;
  private memory: MemoryStore | undefined;
  private sessionId: string | undefined;
  private compactor: ContextCompactor | null;

  private constructor(
    model: ModelAdapter,
    registry: ToolRegistry,
    resolvedSystem: string | undefined,
    options: AgentEngineOptions,
    savedHistory: Message[],
  ) {
    this.model = model;
    this.registry = registry;
    this.resolvedSystem = resolvedSystem;
    this.maxIterations = options.maxIterations ?? 10;
    this.maxTokens = options.maxTokens;
    this.memory = options.memory;
    this.sessionId = options.sessionId;
    this.history = savedHistory;
    this.compactor = options.compaction === false
      ? null
      : new ContextCompactor(options.compaction ?? {});
  }

  /**
   * 工厂方法：创建引擎，自动加载上下文文件 + 恢复持久化历史。
   */
  static async create(options: AgentEngineOptions): Promise<AgentEngine> {
    // 注册工具
    const registry = new ToolRegistry();
    for (const t of options.tools ?? []) {
      registry.register(t);
    }

    // 加载上下文文件
    const fileContext = options.contextFiles?.length
      ? await loadContextFiles(options.contextFiles)
      : undefined;
    const resolvedSystem = mergeSystemPrompt(options.system, fileContext);

    // 恢复持久化历史
    let savedHistory: Message[] = [];
    if (options.memory && options.sessionId) {
      savedHistory = await options.memory.load(options.sessionId);
    }

    return new AgentEngine(options.model, registry, resolvedSystem, options, savedHistory);
  }

  // ─── AgentInterface 实现 ──────────────────────────────────────────────────

  get currentModel(): string {
    if (isRoutableModel(this.model)) return this.model.currentModelId;
    return this.model.id;
  }

  listModels(): string[] {
    if (isRoutableModel(this.model)) {
      return this.model.listModels().map(m => m.id);
    }
    return [this.model.id];
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  /** 用外部消息列表替换当前历史（用于多会话隔离时切换上下文）。 */
  loadHistory(messages: Message[]): void {
    this.history = [...messages];
  }

  dumpHistory(): string {
    return this.history
      .map(m => `[${m.role}] ${extractText(m)}`)
      .join('\n');
  }

  switchModel(modelId: string): void {
    if (!isRoutableModel(this.model)) {
      throw new Error('switchModel() requires a ModelRouter.');
    }
    this.model.switchTo(modelId);
  }

  async persist(): Promise<void> {
    if (this.memory && this.sessionId) {
      await this.memory.save(this.sessionId, this.history);
    }
  }

  // ─── 核心对话接口 ─────────────────────────────────────────────────────────

  /**
   * 非流式：等待完整回复文本。
   * 工具调用全部自动执行，最终返回模型的最后一段文字。
   */
  async chat(userInput: string): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.stream(userInput)) {
      if (chunk.type === 'text' && chunk.text) parts.push(chunk.text);
    }
    return parts.join('');
  }

  /**
   * 流式：逐块产生输出，包含文本 + 工具调用事件。
   *
   * 事件类型：
   *   { type: 'text', text }            模型生成的文字（流式）
   *   { type: 'tool_call', tool, input } 即将执行某工具
   *   { type: 'tool_result', tool, result, isError } 工具执行结果
   *   { type: 'done', message }          本轮完成
   */
  async *stream(userInput: string): AsyncIterable<AgentChunk> {
    // 记录用户消息入队前的历史长度，出错时全量回滚
    const snapshotLen = this.history.length;

    // 1. 追加用户消息
    this.history.push({ role: 'user', content: userInput });

    // 1b. Context 压缩：若历史超过阈值，压缩旧消息（异步，不阻塞主流程）
    if (this.compactor?.needsCompaction(this.history)) {
      try {
        this.history = await this.compactor.compact(this.history, this.model);
      } catch {
        // 压缩失败静默忽略，继续正常流程
      }
    }

    const toolDefs = this.registry.definitions();

    // 跨迭代累积 token 用量（工具循环每轮都可能消耗 token）
    const accumulatedUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const toolCalls: ToolUseContent[] = [];

      // 2. 调用模型
      try {
        for await (const chunk of this.model.stream({
          messages: this.history,
          ...(this.resolvedSystem !== undefined && { system: this.resolvedSystem }),
          ...(this.maxTokens !== undefined && { maxTokens: this.maxTokens }),
          ...(toolDefs.length > 0 && { tools: toolDefs }),
        })) {
          if (chunk.type === 'text' && chunk.text) {
            yield { type: 'text', text: chunk.text };
          }
          if (chunk.type === 'done' && chunk.message) {
            // 追加 assistant 消息到历史
            this.history.push(chunk.message);

            // 累积本轮 token 用量
            if (chunk.tokenUsage) {
              accumulatedUsage.inputTokens += chunk.tokenUsage.inputTokens;
              accumulatedUsage.outputTokens += chunk.tokenUsage.outputTokens;
              accumulatedUsage.totalTokens += chunk.tokenUsage.totalTokens;
            }

            // 提取工具调用
            const content = Array.isArray(chunk.message.content)
              ? chunk.message.content
              : typeof chunk.message.content === 'string'
                ? []
                : [chunk.message.content];

            for (const c of content) {
              if (typeof c !== 'string' && c.type === 'tool_use') {
                toolCalls.push(c);
              }
            }
          }
        }
      } catch (err) {
        // 出错时回滚到用户消息发送前的完整历史状态
        // （单纯 pop 只能移除最后一条，在多轮工具迭代中会留下残留消息）
        this.history.length = snapshotLen;
        throw err;
      }

      // 3. 没有工具调用 → 完成，携带累积 token 用量
      if (toolCalls.length === 0) {
        await this.persist();
        yield accumulatedUsage.totalTokens > 0
          ? { type: 'done', tokenUsage: accumulatedUsage }
          : { type: 'done' };
        return;
      }

      // 4. 执行工具调用
      const toolResults: ToolResultContent[] = [];

      for (const tc of toolCalls) {
        yield { type: 'tool_call', tool: tc.name, input: tc.input };

        const tool = this.registry.get(tc.name);
        let result: string;
        let isError = false;

        if (!tool) {
          result = `工具 "${tc.name}" 未注册`;
          isError = true;
        } else {
          try {
            result = await tool.handler(tc.input);
            // 工具输出截断：防止大输出（文件读取、搜索结果）撑爆 context
            if (this.compactor) {
              result = this.compactor.truncateToolOutput(result);
            }
          } catch (err) {
            result = err instanceof Error ? err.message : String(err);
            isError = true;
          }
        }

        yield { type: 'tool_result', tool: tc.name, result, isError };
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result,
          ...(isError && { is_error: true }),
        });
      }

      // 5. 把工具结果作为 user 消息追加到历史，进入下一轮
      this.history.push({ role: 'user', content: toolResults });
    }

    // 超出最大迭代次数
    await this.persist();
    yield accumulatedUsage.totalTokens > 0
      ? { type: 'done', tokenUsage: accumulatedUsage }
      : { type: 'done' };
  }

  // ─── 工具注册（运行时追加）────────────────────────────────────────────────

  registerTool(tool: Tool): this {
    this.registry.register(tool);
    return this;
  }

  get toolCount(): number {
    return this.registry.size;
  }
}
