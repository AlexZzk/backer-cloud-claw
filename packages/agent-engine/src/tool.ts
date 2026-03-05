import type { ToolDefinition } from '@bcc/foundation';

/**
 * Tool：一个可被模型调用的工具。
 *
 * definition 告诉模型"这个工具是什么、接受什么参数"；
 * handler    是实际执行逻辑，返回字符串结果（模型可读）。
 *
 * 示例：
 *   {
 *     definition: {
 *       name: 'calculator',
 *       description: '计算数学表达式',
 *       inputSchema: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] },
 *     },
 *     handler: async ({ expr }) => String(eval(String(expr))),
 *   }
 */
export interface Tool {
  definition: ToolDefinition;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

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
