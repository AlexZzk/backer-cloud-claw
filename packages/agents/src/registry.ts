import type { Tool } from '@bcc/foundation';
import type { NamedAgent } from './types.js';

/**
 * AgentRegistry — 多 Agent 注册与管理
 *
 * 职责：
 *   1. 管理所有已创建的 NamedAgent 实例
 *   2. 提供 asTools() — 将所有 Agent 转为 Tool 列表，供 Orchestrator 调用
 *   3. 支持 Orchestrator 模式：主 Agent 自动获得其他所有 Agent 作为委托工具
 *
 * 典型用法：
 *   const registry = new AgentRegistry();
 *   registry.register(coderAgent);
 *   registry.register(researchAgent);
 *
 *   // Orchestrator 获取所有子 Agent 工具
 *   const tools = registry.asTools('orchestrator');
 *   orchestratorAgent.registerTool(tools[0]!);  // 注入子 Agent 工具
 */
export class AgentRegistry {
  private agents = new Map<string, NamedAgent>();

  register(agent: NamedAgent): this {
    this.agents.set(agent.def.id, agent);
    return this;
  }

  find(id: string): NamedAgent | undefined {
    return this.agents.get(id);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  /** 返回所有 Agent，按注册顺序 */
  list(): NamedAgent[] {
    return [...this.agents.values()];
  }

  get size(): number {
    return this.agents.size;
  }

  /**
   * 将所有 Agent（排除 excludeId 对应的自身）转为 Tool 列表。
   *
   * 主要用途：将子 Agent 工具注入到 Orchestrator，使其可以委托任务。
   *
   * @param excludeId 排除此 ID 的 Agent（通常是调用者自身，避免自我调用）
   */
  asTools(excludeId?: string): Tool[] {
    return this.list()
      .filter(a => a.def.id !== excludeId)
      .map(a => a.asTool());
  }

  /**
   * 返回 primary Agent（def.primary = true 的第一个，否则列表第一个）。
   */
  getPrimary(): NamedAgent | undefined {
    const all = this.list();
    return all.find(a => a.def.primary) ?? all[0];
  }
}
