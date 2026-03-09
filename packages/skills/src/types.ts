/**
 * Skill — 命名提示词模板
 *
 * 设计目标：
 *   - 节省 token：不需要每次手写长提示词
 *   - 可复用：常用操作一次定义，随处调用
 *   - 可组合：未来 Agent 可以拥有自己的技能集
 */

export interface Skill {
  /**
   * 唯一名称，用于 /skill 命令。
   * 只允许字母、数字、连字符，不含空格。
   * 例如："summarize"、"code-review"、"translate-en"
   */
  name: string;

  /** 一句话描述，显示在 /skills 列表中 */
  description: string;

  /**
   * 提示词模板。
   * 支持 {input} 占位符 — 调用时替换为用户输入。
   * 若不含 {input}，模板直接作为用户消息发送。
   * 例如："请用3句话总结以下内容：\n\n{input}"
   */
  prompt: string;

  /**
   * 临时 system prompt（可选）。
   * 调用此技能时，临时覆盖当前 session 的 system prompt。
   * 调用完成后自动恢复原 system prompt。
   */
  system?: string;

  /**
   * 技能来源（运行时注入，用户文件中不需要填写）：
   *   'builtin'  内置技能（只读）
   *   'user'     用户技能（~/.bcc/skills/）
   *   'project'  项目技能（./.bcc/skills/，优先级最高）
   */
  source?: 'builtin' | 'user' | 'project';
}

/** 从磁盘读取的原始 JSON 结构（宽松类型，用于校验） */
export interface RawSkillFile {
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
  system?: unknown;
}
