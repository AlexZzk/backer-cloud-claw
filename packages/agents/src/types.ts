import type { AgentInterface, Tool } from '@bcc/foundation';

/**
 * NamedAgent — 具名、可组合 Agent 的最小接口。
 *
 * AgentRegistry 针对此接口编程，不依赖具体的 BccAgent 实现，
 * 便于注册任意满足此协议的 Agent（如 ScheduledAgent、VisionAgent 等）。
 */
export interface NamedAgent extends AgentInterface {
  /** Agent 元数据 */
  readonly def: AgentDef;
  /** 将自身转为可委托工具，供 Orchestrator 调用 */
  asTool(): Tool;
  /** 动态追加工具 */
  registerTool(tool: Tool): void;
}

/**
 * AgentDef — Agent 的定义（可序列化到 config.json）
 *
 * 与 ModelInstanceConfig 不同，AgentDef 描述的是一个"角色"，不是一个 API 连接。
 * 一个 Agent 通过 model 字段引用已配置的模型实例。
 */
export interface AgentDef {
  /**
   * 唯一 ID，用于 /agent 命令和 agent 间委托。
   * 例如："orchestrator"、"coder"、"research"
   */
  id: string;

  /** 显示名称（如"研究员"、"程序员"） */
  name: string;

  /**
   * Agent 的能力描述。
   * 当其他 Agent 将此 Agent 作为 Tool 调用时，此描述告知模型"何时调用它"。
   * 例如："负责编写、审查、调试代码，擅长多种编程语言"
   */
  description: string;

  /**
   * System Prompt — 定义 Agent 的角色、行为、边界。
   * 例如："你是一个严谨的代码专家，只回答与代码相关的问题..."
   */
  system: string;

  /**
   * 引用 config.models 中的某个实例 ID（例如："claude"、"deepseek"）。
   * 不填时使用全局主模型（primary）。
   */
  model?: string;

  /**
   * 此 Agent 是否为主对话 Agent（用户默认对话对象）。
   * 多 Agent 配置中，有且只有一个 Agent 可设为 primary。
   */
  primary?: boolean;

  /**
   * 技能标签（元数据，表明此 Agent 擅长哪些领域）。
   * 不影响运行时行为，用于 /agents 展示和文档目的。
   * 例如：["summarize", "translate", "review"]
   */
  skills?: string[];
}
