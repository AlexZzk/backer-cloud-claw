/**
 * SessionStore：管理 HTTP 服务器内的活跃对话会话。
 *
 * 支持三种会话类型：
 *   chat  — 用户与单个 Worker 的对话
 *   dm    — 两个 Worker 之间的直接消息（DM）会话
 *   group — 用户与多个 Worker 的群聊会话
 *
 * 会话元数据和消息历史持久化到磁盘（默认 ~/.bcc/sessions/），
 * AgentInterface 对象无法序列化，在首次使用时懒加载重建。
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentInterface } from '@bcc/foundation';
import type { ApiMessage, ApiSession, SessionType } from './types.js';

export interface SessionEntry {
  id: string;
  type: SessionType;
  workerId: string;          // chat/group 主 worker；dm: 发起方 worker ID
  toWorkerId?: string;       // dm: 接收方 worker ID
  workerIds?: string[];      // group: 所有参与 worker IDs（含 workerId）
  title: string;
  /** 会话内容摘要，由 LLM 生成，供后续新会话注入跨会话上下文时使用 */
  summary?: string;
  createdAt: number;
  updatedAt: number;
  agent?: AgentInterface;    // chat: 唯一 agent；dm: 发起方 agent；group: 第一个 worker 的 agent（从磁盘恢复时为 undefined，按需重建）
  toAgent?: AgentInterface;  // dm: 接收方 agent
  groupAgents?: Map<string, AgentInterface>; // group: workerId → agent
  messages: ApiMessage[];
}

/** 磁盘序列化格式（不含不可序列化的 agent 对象） */
interface PersistedSession {
  id: string;
  type: SessionType;
  workerId: string;
  toWorkerId?: string;
  workerIds?: string[];
  title: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
  messages: ApiMessage[];
}

const DEFAULT_DIR = join(homedir(), '.bcc', 'sessions');

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private dir: string;
  private dirReady = false;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_DIR;
  }

  // ── 创建 chat 会话（用户↔Worker）────────────────────────────────────────────

  create(workerId: string, agent: AgentInterface): SessionEntry {
    const entry: SessionEntry = {
      id:        randomUUID(),
      type:      'chat',
      workerId,
      title:     '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agent,
      messages:  [],
    };
    this.sessions.set(entry.id, entry);
    void this._save(entry);
    return entry;
  }

  // ── 创建 DM 会话（Worker↔Worker）────────────────────────────────────────────

  createDm(
    fromWorkerId: string,
    toWorkerId: string,
    fromAgent: AgentInterface,
    toAgent: AgentInterface,
  ): SessionEntry {
    const entry: SessionEntry = {
      id:          randomUUID(),
      type:        'dm',
      workerId:    fromWorkerId,
      toWorkerId,
      title:       '员工对话',
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
      agent:       fromAgent,
      toAgent,
      messages:    [],
    };
    this.sessions.set(entry.id, entry);
    void this._save(entry);
    return entry;
  }

  // ── 创建 group 会话（用户↔多 Worker 群聊）───────────────────────────────────

  createGroup(
    workerIds: string[],
    agents: Map<string, AgentInterface>,
    title?: string,
  ): SessionEntry {
    const primaryWorkerId = workerIds[0]!;
    const primaryAgent = agents.get(primaryWorkerId)!;
    const workerNames = workerIds.join('、');
    const entry: SessionEntry = {
      id:          randomUUID(),
      type:        'group',
      workerId:    primaryWorkerId,
      workerIds:   [...workerIds],
      title:       title ?? `群聊（${workerNames}）`,
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
      agent:       primaryAgent,
      groupAgents: new Map(agents),
      messages:    [],
    };
    this.sessions.set(entry.id, entry);
    void this._save(entry);
    return entry;
  }

  /** 查找某个 Worker 已有的 chat 会话（用户↔Worker 1对1，幂等创建用） */
  findChat(workerId: string): SessionEntry | undefined {
    for (const s of this.sessions.values()) {
      if (s.type === 'chat' && s.workerId === workerId) return s;
    }
    return undefined;
  }

  /** 查找两个 Worker 之间已有的 DM 会话（双向匹配） */
  findDm(workerIdA: string, workerIdB: string): SessionEntry | undefined {
    for (const s of this.sessions.values()) {
      if (s.type !== 'dm') continue;
      const match =
        (s.workerId === workerIdA && s.toWorkerId === workerIdB) ||
        (s.workerId === workerIdB && s.toWorkerId === workerIdA);
      if (match) return s;
    }
    return undefined;
  }

  // ── 查询 ─────────────────────────────────────────────────────────────────────

  get(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  /** 返回某 Worker 参与的所有会话（包括 DM 中的发起方和接收方，以及 group） */
  listByWorker(workerId: string): SessionEntry[] {
    return [...this.sessions.values()]
      .filter(s =>
        s.workerId === workerId ||
        (s.type === 'dm' && s.toWorkerId === workerId) ||
        (s.type === 'group' && s.workerIds?.includes(workerId))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listAll(): SessionEntry[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 更新会话摘要（持久化到磁盘） */
  setSummary(id: string, summary: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    entry.summary = summary;
    entry.updatedAt = Date.now();
    void this._save(entry);
    return true;
  }

  /** 更新会话标题（持久化到磁盘） */
  updateTitle(id: string, title: string): boolean {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    entry.title = title;
    entry.updatedAt = Date.now();
    void this._save(entry);
    return true;
  }

  delete(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) {
      void unlink(this._pathFor(id)).catch(() => {/* 文件不存在时静默忽略 */});
    }
    return existed;
  }

  // ── 持久化 ───────────────────────────────────────────────────────────────────

  /**
   * 将指定会话的消息和元数据持久化到磁盘。
   * 在每次消息处理完成后调用，保证聊天记录不因服务重启而丢失。
   */
  async persistEntry(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (entry) await this._save(entry);
  }

  /**
   * 从磁盘加载所有持久化会话（元数据 + 消息历史）。
   * AgentInterface 对象不可序列化，加载后 agent/toAgent/groupAgents 均为 undefined，
   * 需要在首次处理消息时由 HttpServer 按需重建。
   */
  async loadFromDisk(): Promise<void> {
    await this._ensureDir();
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.dir, file), 'utf-8');
        const data = JSON.parse(raw) as PersistedSession;
        // 仅在内存中尚未存在时才加载（避免覆盖本次进程已创建的会话）
        if (!this.sessions.has(data.id)) {
          this.sessions.set(data.id, {
            id:        data.id,
            type:      data.type,
            workerId:  data.workerId,
            title:     data.title,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            messages:  data.messages ?? [],
            // 可选字段仅在存在时设置（exactOptionalPropertyTypes 要求）
            ...(data.toWorkerId !== undefined && { toWorkerId: data.toWorkerId }),
            ...(data.workerIds  !== undefined && { workerIds:  data.workerIds }),
            ...(data.summary    !== undefined && { summary:    data.summary }),
            // agent/toAgent/groupAgents 留 undefined，由 HttpServer 按需重建
          });
        }
      } catch {
        // 跳过损坏的文件
      }
    }
  }

  // ── 序列化 ───────────────────────────────────────────────────────────────────

  toApiSession(entry: SessionEntry): ApiSession {
    return {
      id:           entry.id,
      type:         entry.type,
      workerId:     entry.workerId,
      ...(entry.toWorkerId  && { toWorkerId:  entry.toWorkerId }),
      ...(entry.workerIds   && { workerIds:   entry.workerIds }),
      title:        entry.title,
      ...(entry.summary     && { summary:     entry.summary }),
      createdAt:    entry.createdAt,
      updatedAt:    entry.updatedAt,
      messageCount: entry.messages.length,
    };
  }

  // ── 私有工具 ─────────────────────────────────────────────────────────────────

  private async _save(entry: SessionEntry): Promise<void> {
    await this._ensureDir();
    const data: PersistedSession = {
      id:         entry.id,
      type:       entry.type,
      workerId:   entry.workerId,
      ...(entry.toWorkerId && { toWorkerId: entry.toWorkerId }),
      ...(entry.workerIds  && { workerIds:  entry.workerIds }),
      title:      entry.title,
      ...(entry.summary    && { summary:    entry.summary }),
      createdAt:  entry.createdAt,
      updatedAt:  entry.updatedAt,
      messages:   entry.messages,
    };
    await writeFile(this._pathFor(entry.id), JSON.stringify(data, null, 2), 'utf-8');
  }

  private _pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async _ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.dir, { recursive: true });
    this.dirReady = true;
  }
}
