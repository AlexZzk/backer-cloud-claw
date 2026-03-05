import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * 从文件加载上下文提示词（AGENTS.md / SOUL.md 等）。
 *
 * 文件内容直接作为系统提示的一部分。如果文件不存在，返回 undefined。
 * 支持多个文件，按顺序拼接（用 \n\n 分隔）。
 *
 * 示例：
 *   loadContextFiles(['./AGENTS.md', './SOUL.md'])
 */
export async function loadContextFiles(paths: string[]): Promise<string | undefined> {
  const parts: string[] = [];

  for (const p of paths) {
    try {
      const content = await readFile(resolve(p), 'utf-8');
      if (content.trim()) parts.push(content.trim());
    } catch {
      // 文件不存在或无权限：跳过
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * 合并系统提示：将 contextFiles 内容前置于 base 提示词之前。
 */
export function mergeSystemPrompt(
  base: string | undefined,
  fromFiles: string | undefined,
): string | undefined {
  if (!fromFiles && !base) return undefined;
  if (!fromFiles) return base;
  if (!base) return fromFiles;
  return `${fromFiles}\n\n---\n\n${base}`;
}
