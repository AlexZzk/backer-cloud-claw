import { AgentEngine } from '@bcc/agent-engine';
import type { AgentChunk, AgentInterface, MemoryStore, Message, Tool } from '@bcc/foundation';
import type { ModelAdapter } from '@bcc/model-core';
import type { AgentDef } from './types.js';

export interface BccAgentOptions {
  def: AgentDef;
  model: ModelAdapter;
  /** 给此 Agent 注册的工具（通常由 AgentRegistry 注入子 Agent 工具） */
  tools?: Tool[];
  /** 持久化存储（可选，按 def.id 隔离 session） */
  memory?: MemoryStore;
}

/**
 * BccAgent — 具名、可组合的 Agent
 *
 * 在 AgentEngine 基础上增加：
 *   - 元数据（id / name / description）
 *   - asTool()：将自身暴露为 Tool，供 Orchestrator 委托调用
 *   - chat()：便捷的非流式接口
 *
 * 实现了 AgentInterface，可直接传给 CliChannel / REPL 进行交互。
 */
export class BccAgent implements AgentInterface {
  readonly def: AgentDef;
  private engine: AgentEngine;

  private constructor(def: AgentDef, engine: AgentEngine) {
    this.def = def;
    this.engine = engine;
  }

  static async create(options: BccAgentOptions): Promise<BccAgent> {
    const { def, model, tools, memory } = options;
    const engine = await AgentEngine.create({
      model,
      system: def.system,
      tools: tools ?? [],
      ...(memory && { memory, sessionId: `agent:${def.id}` }),
    });
    return new BccAgent(def, engine);
  }

  // ─── AgentInterface ────────────────────────────────────────────────────────

  get currentModel(): string {
    return this.engine.currentModel;
  }

  listModels(): string[] {
    return this.engine.listModels();
  }

  getHistory(): Message[] {
    return this.engine.getHistory();
  }

  clearHistory(): void {
    this.engine.clearHistory();
  }

  dumpHistory(): string {
    return this.engine.dumpHistory();
  }

  switchModel(modelId: string): void {
    this.engine.switchModel?.(modelId);
  }

  async persist(): Promise<void> {
    await this.engine.persist?.();
  }

  stream(userInput: string): AsyncIterable<AgentChunk> {
    return this.engine.stream(userInput);
  }

  // ─── 便捷接口 ────────────────────────────────────────────────────────────────

  /** 非流式对话，返回完整回复文本（用于 Agent 间委托） */
  async chat(userInput: string): Promise<string> {
    const parts: string[] = [];
    for await (const chunk of this.stream(userInput)) {
      if (chunk.type === 'text' && chunk.text) parts.push(chunk.text);
    }
    return parts.join('');
  }

  // ─── Agent-as-Tool ────────────────────────────────────────────────────────

  /**
   * 将此 Agent 转为 Tool，供其他 Agent（通常是 Orchestrator）委托调用。
   *
   * Tool 名称：agent_<id>（如 agent_coder、agent_research）
   * 调用方式：模型发出 tool_use 请求 → 本 Agent 处理 → 返回文本
   *
   * 注意：委托调用使用独立历史（子 Agent 的对话历史与 Orchestrator 隔离）。
   */
  asTool(): Tool {
    return {
      definition: {
        name: `agent_${this.def.id}`,
        description: `[Agent委托] ${this.def.name}：${this.def.description}`,
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: '发送给此 Agent 的消息或任务描述',
            },
          },
          required: ['message'],
        },
      },
      handler: async (input: Record<string, unknown>): Promise<string> => {
        const msg = String(input['message'] ?? '');
        return this.chat(msg);
      },
    };
  }

  /** 动态追加工具（用于在注册表完成后注入子 Agent 工具） */
  registerTool(tool: Tool): void {
    this.engine.registerTool(tool);
  }
}
