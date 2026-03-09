import type { Tool } from '@bcc/foundation';

/**
 * 内置工具（Worker 可配置的功能性工具）。
 *
 * 与 @bcc/skills 的 Skill（提示词模板）概念不同：
 *   Skill = prompt 模板（节省 token，提升质量）
 *   Tool  = 可执行的函数（Worker 调用后获得真实数据/副作用）
 *
 * Worker 在 config.tools 中声明使用哪些工具 ID，
 * buildWorkerRegistry 通过 BUILTIN_TOOLS 查表注册。
 */
export const BUILTIN_TOOLS: Record<string, Tool> = {

  // ─── datetime ──────────────────────────────────────────────────────────────
  'datetime': {
    definition: {
      name: 'datetime',
      description: '获取当前的日期和时间（本地时区）',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async () => {
      return new Date().toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
    },
  },

  // ─── file-read ─────────────────────────────────────────────────────────────
  'file-read': {
    definition: {
      name: 'file_read',
      description: '读取指定路径的文件内容（文本文件）',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件路径（绝对路径或相对于当前工作目录）',
          },
        },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const { path } = input as { path: string };
      if (!path) return '错误：未提供文件路径';
      const { readFile } = await import('node:fs/promises');
      try {
        const content = await readFile(path, 'utf-8');
        // 限制返回长度，避免 context 溢出
        if (content.length > 8000) {
          return content.slice(0, 8000) + `\n\n[内容已截断，共 ${content.length} 字符，仅显示前 8000 字符]`;
        }
        return content;
      } catch (err) {
        return `错误：无法读取文件 "${path}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  // ─── file-write ────────────────────────────────────────────────────────────
  'file-write': {
    definition: {
      name: 'file_write',
      description: '将内容写入指定路径的文件（会覆盖已有文件）',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要写入的文件路径',
          },
          content: {
            type: 'string',
            description: '要写入的文件内容',
          },
        },
        required: ['path', 'content'],
      },
    },
    handler: async (input) => {
      const { path, content } = input as { path: string; content: string };
      if (!path) return '错误：未提供文件路径';
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content ?? '', 'utf-8');
        return `已成功写入文件：${path}`;
      } catch (err) {
        return `错误：无法写入文件 "${path}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  // ─── web-fetch ─────────────────────────────────────────────────────────────
  'web-fetch': {
    definition: {
      name: 'web_fetch',
      description: '获取指定 URL 的网页内容（纯文本，自动去除 HTML 标签）',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要获取的 URL',
          },
        },
        required: ['url'],
      },
    },
    handler: async (input) => {
      const { url } = input as { url: string };
      if (!url) return '错误：未提供 URL';
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'bcc-worker/0.1 (AI research assistant)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return `错误：HTTP ${res.status} ${res.statusText}`;
        const html = await res.text();
        // 简单去除 HTML 标签，提取可读文本
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (text.length > 6000) {
          return text.slice(0, 6000) + `\n\n[内容已截断，仅显示前 6000 字符]`;
        }
        return text || '（页面内容为空）';
      } catch (err) {
        return `错误：无法获取 "${url}"：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },

  // ─── shell-exec（谨慎使用）────────────────────────────────────────────────
  'shell-exec': {
    definition: {
      name: 'shell_exec',
      description: '在当前工作目录执行 shell 命令（仅限安全只读命令，如 ls / cat / find）',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 shell 命令',
          },
        },
        required: ['command'],
      },
    },
    handler: async (input) => {
      const { command } = input as { command: string };
      if (!command) return '错误：未提供命令';
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 10_000,
          cwd: process.cwd(),
        });
        const out = (stdout + stderr).trim();
        if (out.length > 4000) {
          return out.slice(0, 4000) + '\n[输出已截断]';
        }
        return out || '（命令执行完成，无输出）';
      } catch (err) {
        return `错误：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
};

/**
 * 所有内置工具的元信息列表（供 CLI 向导展示）。
 */
export const BUILTIN_TOOL_LIST: Array<{ id: string; description: string }> = [
  { id: 'datetime',   description: '获取当前日期和时间' },
  { id: 'file-read',  description: '读取文件内容' },
  { id: 'file-write', description: '写入文件内容（会覆盖）' },
  { id: 'web-fetch',  description: '获取网页内容（纯文本）' },
  { id: 'shell-exec', description: '执行 shell 命令（ls/cat/find 等）' },
];

/** 按 ID 获取内置工具 */
export function getBuiltinTool(id: string): Tool | undefined {
  return BUILTIN_TOOLS[id];
}
