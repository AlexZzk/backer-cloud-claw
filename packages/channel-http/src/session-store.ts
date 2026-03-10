/**
 * SessionStore：管理 HTTP 服务器内的活跃对话会话。
 *
 * 每个会话 = 一个独立的 AgentEngine 实例（与 Worker Config 绑定）。
 * 会话在内存中维护，服务重启后清空（不持久化）。
 */

import { randomUUID } from 'node:crypto';
import type { AgentInterface } from '@bcc/foundation';
import type { ApiMessage, ApiSession } from './types.js';

export interface SessionEntry {
  id: string;
  workerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  agent: AgentInterface;
  messages: ApiMessage[];
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();

  create(workerId: string, agent: AgentInterface): SessionEntry {
    const entry: SessionEntry = {
      id: randomUUID(),
      workerId,
      title: '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agent,
      messages: [],
    };
    this.sessions.set(entry.id, entry);
    return entry;
  }

  get(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  listByWorker(workerId: string): SessionEntry[] {
    return [...this.sessions.values()]
      .filter(s => s.workerId === workerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  listAll(): SessionEntry[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  toApiSession(entry: SessionEntry): ApiSession {
    return {
      id: entry.id,
      workerId: entry.workerId,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      messageCount: entry.messages.length,
    };
  }
}
