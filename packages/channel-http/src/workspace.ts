/**
 * Worker 文件工作空间工具
 *
 * 每个 Worker 拥有独立的工作空间目录（默认 ~/.bcc/workspaces/{workerId}），
 * 以及一个所有 Worker 只读共享的共享目录（默认 ~/.bcc/shared）。
 *
 * 权限规则：
 *  - 工作空间：可创建、读取、修改、删除（CRUD）
 *  - 共享目录：只读（通过 workspace_read 使用 "shared/" 前缀访问）
 *  - 路径均相对于工作空间根目录，禁止路径穿越（..）
 */

import { readFile, writeFile, unlink, readdir, stat, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve, relative, basename, extname } from 'node:path';
import type { BccConfig, WorkerConfig } from './config-loader.js';
import type { Tool } from '@bcc/foundation';

// ─── 路径工具 ─────────────────────────────────────────────────────────────────

/** 解析 Worker 的工作空间目录（绝对路径）*/
export function resolveWorkspaceDir(workerCfg: WorkerConfig, config: BccConfig): string {
  if (workerCfg.workspace) return workerCfg.workspace;
  return join(config.defaults.workspaceBaseDir, workerCfg.id);
}

/** 解析共享目录（绝对路径）*/
export function resolveSharedDir(config: BccConfig): string {
  return config.defaults.sharedDir;
}

/**
 * 安全解析相对路径，防止路径穿越攻击（../）。
 * 返回绝对路径，若路径逃出 base 则返回 null。
 */
export function safePath(base: string, rel: string): string | null {
  if (!rel) return null;
  const abs = resolve(base, rel);
  // 确保解析后的路径仍在 base 目录下
  const rel2 = relative(base, abs);
  if (rel2.startsWith('..') || rel2.startsWith('/')) return null;
  return abs;
}

// ─── 文件列表 ─────────────────────────────────────────────────────────────────

export interface WorkspaceFileEntry {
  name: string;
  path: string;       // 相对于工作空间根目录的路径
  size: number;       // 字节数
  mtime: number;      // Unix 毫秒时间戳
  isDir: boolean;
}

/** 递归（最多2层）列出目录下的所有文件 */
async function listFilesRecursive(
  base: string,
  dir: string,
  depth = 0,
): Promise<WorkspaceFileEntry[]> {
  const entries: WorkspaceFileEntry[] = [];
  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }
  for (const item of items) {
    const abs = join(dir, item);
    let s;
    try { s = await stat(abs); } catch { continue; }
    const rel = relative(base, abs);
    if (s.isDirectory()) {
      entries.push({ name: item, path: rel, size: 0, mtime: s.mtimeMs, isDir: true });
      if (depth < 2) {
        entries.push(...await listFilesRecursive(base, abs, depth + 1));
      }
    } else {
      entries.push({ name: item, path: rel, size: s.size, mtime: s.mtimeMs, isDir: false });
    }
  }
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export async function listWorkspaceFiles(workspaceDir: string): Promise<WorkspaceFileEntry[]> {
  return listFilesRecursive(workspaceDir, workspaceDir);
}

export async function listSharedFiles(sharedDir: string): Promise<WorkspaceFileEntry[]> {
  return listFilesRecursive(sharedDir, sharedDir);
}

// ─── 工作空间工具工厂 ─────────────────────────────────────────────────────────

/**
 * 为指定 Worker 创建工作空间感知工具集。
 *
 * 路径规则（对 Worker 的 LLM）：
 *  - 工作空间内文件：直接用相对路径，如 `需求说明书.md`
 *  - 共享目录文件：用 `shared/` 前缀，如 `shared/设计稿.png`
 */
export function createWorkspaceTools(workspaceDir: string, sharedDir: string): Record<string, Tool> {

  // ── workspace_list ──────────────────────────────────────────────────────────
  const workspaceList: Tool = {
    definition: {
      name: 'workspace_list',
      description:
        '列出你的工作空间中的所有文件和文件夹。' +
        '也会显示共享目录（shared/）中可读取的文件。',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    handler: async () => {
      const [myFiles, sharedFiles] = await Promise.all([
        listWorkspaceFiles(workspaceDir),
        listSharedFiles(sharedDir),
      ]);
      const lines: string[] = [];
      lines.push(`📁 工作空间：${workspaceDir}`);
      if (myFiles.length === 0) {
        lines.push('  （空）');
      } else {
        for (const f of myFiles) {
          const size = f.isDir ? '' : ` (${formatSize(f.size)})`;
          lines.push(`  ${f.isDir ? '📁' : '📄'} ${f.path}${size}`);
        }
      }
      lines.push('');
      lines.push(`📂 共享目录（只读）：${sharedDir}`);
      if (sharedFiles.length === 0) {
        lines.push('  （空）');
      } else {
        for (const f of sharedFiles) {
          const size = f.isDir ? '' : ` (${formatSize(f.size)})`;
          lines.push(`  ${f.isDir ? '📁' : '📄'} shared/${f.path}${size}`);
        }
      }
      return lines.join('\n');
    },
  };

  // ── workspace_read ──────────────────────────────────────────────────────────
  const workspaceRead: Tool = {
    definition: {
      name: 'workspace_read',
      description:
        '读取工作空间或共享目录中的文件内容（仅限文本文件）。' +
        '路径相对于工作空间根目录；读取共享目录文件需加 "shared/" 前缀。',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件相对路径，如 "报告.md" 或 "shared/设计稿说明.txt"',
          },
        },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const { path: rel } = input as { path: string };
      let absPath: string | null;
      let label: string;

      if (rel.startsWith('shared/')) {
        const relShared = rel.slice('shared/'.length);
        absPath = safePath(sharedDir, relShared);
        label = `共享/${relShared}`;
      } else {
        absPath = safePath(workspaceDir, rel);
        label = rel;
      }
      if (!absPath) return `错误：非法路径 "${rel}"`;

      try {
        const content = await readFile(absPath, 'utf-8');
        if (content.length > 10_000) {
          return content.slice(0, 10_000) +
            `\n\n[内容已截断，共 ${content.length} 字符，仅显示前 10000 字符]`;
        }
        return content;
      } catch (err) {
        return `错误：无法读取 "${label}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  // ── workspace_write ─────────────────────────────────────────────────────────
  const workspaceWrite: Tool = {
    definition: {
      name: 'workspace_write',
      description:
        '将内容写入你的工作空间中的文件（会覆盖已有文件，自动创建目录）。' +
        '路径相对于工作空间根目录，不可写入共享目录。',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件相对路径，如 "需求说明书.md" 或 "designs/login.md"',
          },
          content: { type: 'string', description: '要写入的文件内容' },
        },
        required: ['path', 'content'],
      },
    },
    handler: async (input) => {
      const { path: rel, content } = input as { path: string; content: string };
      if (rel.startsWith('shared/')) return '错误：共享目录为只读，不可写入';
      const absPath = safePath(workspaceDir, rel);
      if (!absPath) return `错误：非法路径 "${rel}"`;
      try {
        const { dirname } = await import('node:path');
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, content ?? '', 'utf-8');
        return `✅ 已写入：${rel} (${formatSize(Buffer.byteLength(content ?? '', 'utf-8'))})`;
      } catch (err) {
        return `错误：无法写入 "${rel}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  // ── workspace_delete ────────────────────────────────────────────────────────
  const workspaceDelete: Tool = {
    definition: {
      name: 'workspace_delete',
      description: '删除你的工作空间中的指定文件（路径相对于工作空间根目录）。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的文件相对路径' },
        },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const { path: rel } = input as { path: string };
      if (rel.startsWith('shared/')) return '错误：无法删除共享目录中的文件';
      const absPath = safePath(workspaceDir, rel);
      if (!absPath) return `错误：非法路径 "${rel}"`;
      try {
        await unlink(absPath);
        return `✅ 已删除：${rel}`;
      } catch (err) {
        return `错误：无法删除 "${rel}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  // ── workspace_share ─────────────────────────────────────────────────────────
  const workspaceShare: Tool = {
    definition: {
      name: 'workspace_share',
      description:
        '将你工作空间中的文件复制到共享目录，供其他 Worker 只读访问。' +
        '源路径相对于工作空间，目标文件名默认与源文件名相同（可自定义）。',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要分享的文件相对路径（工作空间内），如 "设计稿.png"',
          },
          targetName: {
            type: 'string',
            description: '共享目录中的目标文件名（可选，默认与源文件名相同）',
          },
        },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const { path: rel, targetName } = input as { path: string; targetName?: string };
      if (rel.startsWith('shared/')) return '错误：源文件不能来自共享目录';
      const srcPath = safePath(workspaceDir, rel);
      if (!srcPath) return `错误：非法源路径 "${rel}"`;
      const destName = targetName?.trim() || basename(rel);
      const destPath = safePath(sharedDir, destName);
      if (!destPath) return `错误：非法目标文件名 "${destName}"`;
      try {
        await mkdir(sharedDir, { recursive: true });
        await copyFile(srcPath, destPath);
        return `✅ 已分享到共享目录：${destName}\n其他 Worker 可用路径 "shared/${destName}" 访问。`;
      } catch (err) {
        return `错误：分享失败：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  return {
    'workspace-list':   workspaceList,
    'workspace-read':   workspaceRead,
    'workspace-write':  workspaceWrite,
    'workspace-delete': workspaceDelete,
    'workspace-share':  workspaceShare,
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 根据文件扩展名推断 MIME 类型（用于 HTTP 下载） */
export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const MAP: Record<string, string> = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.pdf':  'application/pdf',
    '.md':   'text/markdown; charset=utf-8',
    '.txt':  'text/plain; charset=utf-8',
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'text/javascript',
    '.ts':   'text/plain; charset=utf-8',
    '.csv':  'text/csv; charset=utf-8',
    '.zip':  'application/zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return MAP[ext] ?? 'application/octet-stream';
}

/** 工作空间工具的系统提示注入 */
export function buildWorkspaceSystemSection(
  workspaceDir: string,
  sharedDir: string,
  tools: string[],
): string {
  const wsTools = tools.filter(t => t.startsWith('workspace-'));
  if (wsTools.length === 0) return '';

  const lines = [
    '## 文件工作空间',
    `你的个人工作空间目录：\`${workspaceDir}\`（完全可读写）`,
    `共享目录（只读）：\`${sharedDir}\``,
    '',
    '可用工作空间工具：',
  ];
  if (wsTools.includes('workspace-list'))   lines.push('- `workspace_list`：列出工作空间及共享目录中的文件');
  if (wsTools.includes('workspace-read'))   lines.push('- `workspace_read`：读取文件内容（工作空间或 shared/前缀访问共享）');
  if (wsTools.includes('workspace-write'))  lines.push('- `workspace_write`：将内容写入工作空间文件');
  if (wsTools.includes('workspace-delete')) lines.push('- `workspace_delete`：删除工作空间中的文件');
  if (wsTools.includes('workspace-share'))  lines.push('- `workspace_share`：将文件复制到共享目录，供其他 Worker 访问');
  lines.push('');
  lines.push('路径均相对于工作空间根目录，禁止使用 `..` 穿越目录。');
  lines.push('读取共享目录文件时，路径使用 `shared/` 前缀，例如：`shared/设计稿.png`。');
  return lines.join('\n');
}

/** 列出 BUILTIN_TOOL_LIST 中工作空间工具的元信息 */
export const WORKSPACE_TOOL_LIST: Array<{ id: string; description: string }> = [
  { id: 'workspace-list',   description: '列出工作空间及共享目录中的文件' },
  { id: 'workspace-read',   description: '读取工作空间或共享目录中的文件' },
  { id: 'workspace-write',  description: '将内容写入工作空间文件' },
  { id: 'workspace-delete', description: '删除工作空间中的文件' },
  { id: 'workspace-share',  description: '将文件复制到共享目录（供其他 Worker 只读）' },
];
