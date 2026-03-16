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

// ─── JSON 格式解析（向后兼容） ─────────────────────────────────────────────────

function parseSkillJson(raw: RawSkillFile, source: 'builtin' | 'user' | 'project'): Skill | null {
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

// ─── Markdown 格式 ────────────────────────────────────────────────────────────
//
// 文件格式（filename = 技能名称.md）：
//
//   ---
//   description: 一句话描述
//   ---
//
//   提示词模板，可含 {input}
//
// 若技能同时包含 system prompt，用 ## System / ## Prompt 分节：
//
//   ---
//   description: ...
//   ---
//
//   ## System
//
//   系统提示词内容...
//
//   ## Prompt
//
//   提示词模板...（可选，无此节则 prompt 为空）
//

/**
 * 解析技能 Markdown 文件。
 * @param filename 文件名（含 .md 后缀），用于提取 name
 * @param content  文件内容
 */
export function parseSkillMd(filename: string, content: string): Omit<Skill, 'source'> | null {
  // 1. 提取 frontmatter（--- ... ---）
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const fmRaw  = fmMatch[1] ?? '';
  const body   = (fmMatch[2] ?? '').trim();

  // 简单 YAML 解析：只处理 key: value 格式（不支持多行值）
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)\s*$/);
    if (m) fm[m[1]!] = (m[2] ?? '').trim();
  }

  const description = fm['description'] ?? '';

  // 2. 从文件名提取 name
  const name = basename(filename, '.md');
  const nameErr = validateSkillName(name);
  if (nameErr) return null;

  // 3. 解析 body：查找 ## System / ## Prompt 分节
  //    节标题匹配（行首 ## + 空格 + System|Prompt，不区分大小写）
  const sysHeaderRe = /^##\s+System\s*$/im;
  const prmHeaderRe = /^##\s+Prompt\s*$/im;

  const sysMatch = sysHeaderRe.exec(body);
  const prmMatch = prmHeaderRe.exec(body);

  let system: string | undefined;
  let prompt: string;

  if (sysMatch !== null) {
    // 有 ## System 节
    const afterSys = body.slice(sysMatch.index + sysMatch[0].length).trim();
    if (prmMatch !== null && prmMatch.index > sysMatch.index) {
      // 同时有 ## Prompt（在 ## System 之后）
      const sysEnd = body.indexOf(prmMatch[0], sysMatch.index);
      system = body.slice(sysMatch.index + sysMatch[0].length, sysEnd).trim() || undefined;
      prompt = body.slice(prmMatch.index + prmMatch[0].length).trim();
    } else {
      system = afterSys || undefined;
      prompt = '';
    }
  } else if (prmMatch !== null) {
    // 只有 ## Prompt（无 ## System）
    prompt = body.slice(prmMatch.index + prmMatch[0].length).trim();
  } else {
    // 无分节，body 整体 = prompt
    prompt = body;
  }

  return {
    name,
    description,
    prompt,
    ...(system !== undefined && { system }),
  };
}

/**
 * 将技能序列化为 Markdown 字符串，可直接写入 .md 文件。
 */
export function serializeSkillMd(skill: Omit<Skill, 'source'>): string {
  const parts: string[] = [];

  parts.push('---');
  parts.push(`description: ${skill.description}`);
  parts.push('---');
  parts.push('');

  if (skill.system) {
    parts.push('## System');
    parts.push('');
    parts.push(skill.system);

    if (skill.prompt.trim()) {
      parts.push('');
      parts.push('## Prompt');
      parts.push('');
      parts.push(skill.prompt);
    }
  } else {
    parts.push(skill.prompt);
  }

  // 确保文件末尾有换行
  const result = parts.join('\n');
  return result.endsWith('\n') ? result : result + '\n';
}

// ─── 从目录加载 ───────────────────────────────────────────────────────────────

async function loadFromDir(dir: string, source: 'builtin' | 'user' | 'project'): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seen = new Set<string>();

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skills; // 目录不存在是正常情况
  }

  // .md 文件优先加载
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    try {
      const text = await readFile(join(dir, entry), 'utf-8');
      const parsed = parseSkillMd(entry, text);
      if (parsed) {
        skills.push({ ...parsed, source });
        seen.add(parsed.name);
      }
    } catch {
      // 单个文件解析失败不影响其他技能
    }
  }

  // .json 文件向后兼容（同名 .md 已加载则跳过）
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const name = basename(entry, '.json');
    if (seen.has(name)) continue;
    try {
      const text = await readFile(join(dir, entry), 'utf-8');
      const raw = JSON.parse(text) as RawSkillFile;
      const skill = parseSkillJson(raw, source);
      if (skill) {
        skills.push(skill);
        seen.add(name);
      }
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

/** 将用户技能保存为 .md 文件（~/.bcc/skills/<name>.md） */
export async function saveUserSkill(skill: Omit<Skill, 'source'>): Promise<void> {
  await mkdir(USER_SKILLS_DIR, { recursive: true });
  const content = serializeSkillMd(skill);
  await writeFile(join(USER_SKILLS_DIR, `${skill.name}.md`), content, 'utf-8');
}

/** 删除用户技能（同时尝试删除 .md 和 .json 两种格式） */
export async function deleteUserSkill(name: string): Promise<boolean> {
  let deleted = false;
  try { await unlink(join(USER_SKILLS_DIR, `${name}.md`));   deleted = true; } catch { /* ok */ }
  try { await unlink(join(USER_SKILLS_DIR, `${name}.json`)); deleted = true; } catch { /* ok */ }
  return deleted;
}

/** 读取单个用户技能（优先读 .md，回退到 .json） */
export async function loadUserSkill(name: string): Promise<Skill | null> {
  // 优先尝试 .md
  try {
    const text = await readFile(join(USER_SKILLS_DIR, `${name}.md`), 'utf-8');
    const parsed = parseSkillMd(`${name}.md`, text);
    if (parsed) return { ...parsed, source: 'user' };
  } catch { /* not found */ }

  // 回退 .json（兼容旧文件）
  try {
    const text = await readFile(join(USER_SKILLS_DIR, `${name}.json`), 'utf-8');
    return parseSkillJson(JSON.parse(text) as RawSkillFile, 'user');
  } catch {
    return null;
  }
}

/** 列出用户技能名称列表（不解析内容） */
export async function listUserSkillNames(): Promise<string[]> {
  try {
    const entries = await readdir(USER_SKILLS_DIR);
    const names = new Set<string>();
    for (const e of entries) {
      if (e.endsWith('.md'))   names.add(basename(e, '.md'));
      else if (e.endsWith('.json')) names.add(basename(e, '.json'));
    }
    return [...names];
  } catch {
    return [];
  }
}
