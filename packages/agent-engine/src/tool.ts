import type { Tool, ToolDefinition } from '@bcc/foundation';

// Tool 接口已移至 @bcc/foundation，此处重新导出保持向后兼容
export type { Tool };

/**
 * ToolRegistry：管理已注册的工具集合。
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }
}
