/**
 * SkillHub 客户端
 *
 * 与远程 SkillHub 服务器通信，提供技能搜索、安装、发布功能。
 *
 * Hub URL 优先级：
 *   1. 构造函数参数
 *   2. 环境变量 BCC_SKILL_HUB_URL
 *   3. 默认值 https://hub.bcc.dev
 */

import { saveUserSkill } from './loader.js';
import type { Skill } from './types.js';

/** 默认 Hub URL */
const DEFAULT_HUB_URL = process.env['BCC_SKILL_HUB_URL'] ?? 'https://hub.bcc.dev';

export interface HubSkill {
  name: string;
  description: string;
  prompt: string;
  system?: string;
  author?: string;
  version?: string;
  downloads?: number;
  tags?: string[];
}

export interface HubSearchResult {
  skills: HubSkill[];
  total: number;
  page: number;
}

export class SkillHub {
  constructor(private readonly baseUrl: string = DEFAULT_HUB_URL) {}

  /** 搜索 Hub 上的技能 */
  async search(query: string, limit = 20): Promise<HubSkill[]> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await fetch(`${this.baseUrl}/api/skills?${qs.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`SkillHub 搜索失败（HTTP ${res.status}）`);
    }
    const data = await res.json() as HubSearchResult | HubSkill[];
    if (Array.isArray(data)) return data;
    return (data as HubSearchResult).skills ?? [];
  }

  /**
   * 从 Hub 安装技能（写入用户技能目录 ~/.bcc/skills/<name>.json）。
   * 若技能已存在，会覆盖现有版本。
   */
  async install(name: string): Promise<HubSkill> {
    const res = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      throw new Error(`Hub 上找不到技能 "${name}"`);
    }
    if (!res.ok) {
      throw new Error(`SkillHub 获取技能失败（HTTP ${res.status}）`);
    }
    const hubSkill = await res.json() as HubSkill;

    const skill: Omit<Skill, 'source'> = {
      name: hubSkill.name,
      description: hubSkill.description,
      prompt: hubSkill.prompt,
      ...(hubSkill.system !== undefined && { system: hubSkill.system }),
    };
    await saveUserSkill(skill);
    return hubSkill;
  }

  /**
   * 发布技能到 Hub（需要 Hub API Token）。
   * Token 可通过 https://hub.bcc.dev 注册后获取。
   */
  async publish(skill: Omit<Skill, 'source'>, token: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/skills`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(skill),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Hub 认证失败，请检查 BCC_HUB_TOKEN 是否正确');
    }
    if (res.status === 409) {
      throw new Error(`技能 "${skill.name}" 已存在于 Hub，请修改名称后重试`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`发布失败（HTTP ${res.status}）${text ? '：' + text : ''}`);
    }
  }
}

/** 默认 SkillHub 实例（使用 DEFAULT_HUB_URL） */
export const defaultHub = new SkillHub();
