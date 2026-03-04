import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  access,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { MemoryStore, Message } from '@bcc/foundation';

export interface FileMemoryStoreOptions {
  /**
   * 会话文件存储目录。
   *
   * 默认：~/.bcc/sessions
   * 可设置为任意路径，由用户完全掌控数据存放位置。
   *
   * 示例：
   *   dir: './data/sessions'           // 项目内
   *   dir: '/mnt/secure/ai-sessions'   // 外部安全存储
   *   dir: process.env.BCC_SESSION_DIR // 环境变量
   */
  dir?: string;

  /**
   * 单个会话最多保存的消息条数（超出时裁剪最旧的，system 消息永远保留）。
   * 默认不限制。
   */
  maxMessages?: number;
}

const DEFAULT_DIR = join(homedir(), '.bcc', 'sessions');

/**
 * FileMemoryStore：基于文件系统的会话记忆存储。
 *
 * 每个会话存储为独立 JSON 文件：{dir}/{sessionId}.json
 * 无任何外部依赖，完全使用 Node.js 内置 fs/promises。
 */
export class FileMemoryStore implements MemoryStore {
  private dir: string;
  private maxMessages: number;
  private initialized = false;

  constructor(options: FileMemoryStoreOptions = {}) {
    this.dir = resolve(options.dir ?? DEFAULT_DIR);
    this.maxMessages = options.maxMessages ?? Infinity;
  }

  async save(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureDir();
    const toSave = this.trim(messages);
    const path = this.pathFor(sessionId);
    const payload: SessionFile = {
      sessionId,
      updatedAt: new Date().toISOString(),
      messages: toSave,
    };
    await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<Message[]> {
    const path = this.pathFor(sessionId);
    if (!(await this.exists(path))) return [];
    try {
      const raw = await readFile(path, 'utf-8');
      const payload = JSON.parse(raw) as SessionFile;
      return payload.messages;
    } catch {
      return [];
    }
  }

  async list(): Promise<string[]> {
    await this.ensureDir();
    const files = await readdir(this.dir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5)); // 去掉 .json 后缀
  }

  async delete(sessionId: string): Promise<void> {
    const path = this.pathFor(sessionId);
    if (await this.exists(path)) {
      await unlink(path);
    }
  }

  /** 获取会话文件的完整路径（可用于备份/迁移） */
  pathFor(sessionId: string): string {
    return join(this.dir, `${sanitizeId(sessionId)}.json`);
  }

  /** 获取存储根目录 */
  get storageDir(): string {
    return this.dir;
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    this.initialized = true;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private trim(messages: Message[]): Message[] {
    if (messages.length <= this.maxMessages) return messages;
    const system = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');
    return [...system, ...rest.slice(-(this.maxMessages - system.length))];
  }
}

// ─── 文件结构 ────────────────────────────────────────────────────────────────

interface SessionFile {
  sessionId: string;
  updatedAt: string;
  messages: Message[];
}

/** sessionId 只允许字母、数字、连字符、下划线，防止路径穿越 */
function sanitizeId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9\-_]/g, '_');
  if (safe !== id) {
    // 避免原始 id 与消过毒的 id 冲突，加一段哈希
    const hash = id
      .split('')
      .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0)
      .toString(16)
      .padStart(4, '0');
    return `${safe}_${hash}`;
  }
  return safe;
}
