import { BUILTIN_SKILLS } from './builtins.js';
import { loadUserSkills, loadProjectSkills } from './loader.js';
import type { Skill } from './types.js';

/**
 * SkillRegistry — 技能注册表
 *
 * 优先级（高 → 低）：
 *   1. 项目技能（./.bcc/skills/）
 *   2. 用户技能（~/.bcc/skills/）
 *   3. 内置技能（@bcc/skills 包内）
 *
 * 同名时，高优先级覆盖低优先级（用户可覆盖内置）。
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  private constructor() {}

  /** 加载所有技能（内置 + 用户 + 项目）*/
  static async load(): Promise<SkillRegistry> {
    const reg = new SkillRegistry();

    // 由低到高加载（后加载的覆盖先加载的）
    for (const s of BUILTIN_SKILLS)                reg.skills.set(s.name, s);
    for (const s of await loadUserSkills())         reg.skills.set(s.name, s);
    for (const s of await loadProjectSkills())      reg.skills.set(s.name, s);

    return reg;
  }

  /** 加载仅内置技能（用于测试或快速场景） */
  static loadBuiltinOnly(): SkillRegistry {
    const reg = new SkillRegistry();
    for (const s of BUILTIN_SKILLS) reg.skills.set(s.name, s);
    return reg;
  }

  find(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** 返回所有技能，按来源分组排序：builtin → user → project */
  list(): Skill[] {
    const order: Skill['source'][] = ['builtin', 'user', 'project'];
    return [...this.skills.values()].sort((a, b) => {
      const ai = order.indexOf(a.source ?? 'builtin');
      const bi = order.indexOf(b.source ?? 'builtin');
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }

  /** 各来源的技能数量 */
  stats(): { builtin: number; user: number; project: number } {
    let builtin = 0, user = 0, project = 0;
    for (const s of this.skills.values()) {
      if (s.source === 'builtin') builtin++;
      else if (s.source === 'user') user++;
      else if (s.source === 'project') project++;
    }
    return { builtin, user, project };
  }

  get size(): number {
    return this.skills.size;
  }
}
