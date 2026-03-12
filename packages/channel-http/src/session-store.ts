/**
 * SessionStore：管理 HTTP 服务器内的活跃对话会话。
 *
 * 支持三种会话类型：
 *   chat  — 用户与单个 Worker 的对话
 *   dm    — 两个 Worker 之间的直接消息（DM）会话
 *   group — 用户与多个 Worker 的群聊会话
 *
 * 会话在内存中维护，服务重启后清空（不持久化）。
 */

import { randomUUID } from 'node:crypto';
import type { AgentInterface } from '@bcc/foundation';
import type { ApiMessage, ApiSession, SessionType } from './types.js';

export interface SessionEntry {
  id: string;
  type: SessionType;
  workerId: string;          // chat/group 主 worker；dm: 发起方 worker ID
  toWorkerId?: string;       // dm: 接收方 worker ID
  workerIds?: string[];      // group: 所有参与 worker IDs（含 workerId）
  title: string;
  createdAt: number;
  updatedAt: number;
  agent: AgentInterface;     // chat: 唯一 agent；dm: 发起方 agent；group: 第一个 worker 的 agent
  toAgent?: AgentInterface;  // dm: 接收方 agent
  groupAgents?: Map<string, AgentInterface>; // group: workerId → agent
  messages: ApiMessage[];
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();

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

  delete(id: string): boolean {
    return this.sessions.delete(id);
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
      createdAt:    entry.createdAt,
      updatedAt:    entry.updatedAt,
      messageCount: entry.messages.length,
    };
  }
}
