import type { Skill } from './types.js';

/**
 * 展开技能模板
 *
 * 将 Skill.prompt 中的 {input} 替换为实际输入。
 * 若模板不含 {input}，则将输入追加到模板末尾（如果有输入的话）。
 */
export function expandSkill(skill: Skill, input: string): string {
  if (skill.prompt.includes('{input}')) {
    return skill.prompt.replace(/\{input\}/g, input);
  }
  // 模板不含 {input}：视为固定提示词，输入追加在末尾
  if (input.trim()) {
    return `${skill.prompt}\n\n${input}`;
  }
  return skill.prompt;
}

/** 检查技能模板是否需要 input（含 {input} 占位符） */
export function skillNeedsInput(skill: Skill): boolean {
  return skill.prompt.includes('{input}');
}
