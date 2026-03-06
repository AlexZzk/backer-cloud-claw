import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, RawSkillFile } from './types.js';

// ─── 路径 ─────────────────────────────────────────────────────────────────────

export const USER_SKILLS_DIR    = join(homedir(), '.bcc', 'skills');
export const PROJECT_SKILLS_DIR = join(process.cwd(), '.bcc', 'skills');

// ─── 校验 ─────────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateSkillName(name: string): string | null {
  if (!name) return '名称不能为空';
  if (!NAME_RE.test(name)) return '名称只允许小写字母、数字、连字符（-），且不能以连字符开头';
  if (name.length > 40) return '名称不超过 40 个字符';
  return null;
}

function parseSkillFile(raw: RawSkillFile, source: 'builtin' | 'user' | 'project'): Skill | null {
  if (typeof raw.name !== 'string' || typeof raw.prompt !== 'string') return null;
  const nameErr = validateSkillName(raw.name);
  if (nameErr) return null;
  return {
    name:        raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    prompt:      raw.prompt,
    ...(typeof raw.system === 'string' && raw.system && { system: raw.system }),
    source,
  };
}

// ─── 从目录加载 ───────────────────────────────────────────────────────────────

async function loadFromDir(dir: string, source: 'builtin' | 'user' | 'project'): Promise<Skill[]> {
  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skills; // 目录不存在是正常情况
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const text = await readFile(join(dir, entry), 'utf-8');
      const raw = JSON.parse(text) as RawSkillFile;
      const skill = parseSkillFile(raw, source);
      if (skill) skills.push(skill);
    } catch {
      // 单个文件解析失败不影响其他技能
    }
  }

  return skills;
}

export async function loadUserSkills(): Promise<Skill[]> {
  return loadFromDir(USER_SKILLS_DIR, 'user');
}

export async function loadProjectSkills(): Promise<Skill[]> {
  return loadFromDir(PROJECT_SKILLS_DIR, 'project');
}

// ─── 保存 / 删除 ─────────────────────────────────────────────────────────────

export async function saveUserSkill(skill: Omit<Skill, 'source'>): Promise<void> {
  await mkdir(USER_SKILLS_DIR, { recursive: true });
  const data: Record<string, string> = {
    name:        skill.name,
    description: skill.description,
    prompt:      skill.prompt,
  };
  if (skill.system) data['system'] = skill.system;
  await writeFile(
    join(USER_SKILLS_DIR, `${skill.name}.json`),
    JSON.stringify(data, null, 2) + '\n',
    'utf-8',
  );
}

export async function deleteUserSkill(name: string): Promise<boolean> {
  try {
    await unlink(join(USER_SKILLS_DIR, `${name}.json`));
    return true;
  } catch {
    return false;
  }
}

/** 读取单个用户技能文件 */
export async function loadUserSkill(name: string): Promise<Skill | null> {
  try {
    const text = await readFile(join(USER_SKILLS_DIR, `${name}.json`), 'utf-8');
    return parseSkillFile(JSON.parse(text) as RawSkillFile, 'user');
  } catch {
    return null;
  }
}

/** 列出用户技能名称列表（不解析内容） */
export async function listUserSkillNames(): Promise<string[]> {
  try {
    const entries = await readdir(USER_SKILLS_DIR);
    return entries.filter(e => e.endsWith('.json')).map(e => basename(e, '.json'));
  } catch {
    return [];
  }
}
