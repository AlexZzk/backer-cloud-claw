import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Chat, ChatMessage, ChatType, ChatMessageStatus } from '@bcc/foundation';

export interface ChatStoreOptions {
  /**
   * 聊天数据存储目录。
   *
   * 默认：~/.bcc/chats
   * 每个会话存储为独立 JSON 文件：{dir}/{chatId}.json
   */
  dir?: string | undefined;
}

interface ChatFile {
  chat: Chat;
  messages: ChatMessage[];
}

const DEFAULT_DIR = join(homedir(), '.bcc', 'chats');

/**
 * ChatStore：基于文件系统的聊天会话存储。
 *
 * 每个会话（Chat）存储为独立 JSON 文件：{dir}/{chatId}.json
 * 文件包含会话元信息（Chat）和全部消息历史（ChatMessage[]）。
 *
 * 设计原则：
 * - 零外部依赖，纯 Node.js 内置模块
 * - 消息顺序按时间戳严格保序
 * - 读写操作幂等，文件损坏时返回空数据而非抛出异常
 */
export class ChatStore {
  private dir: string;
  private initialized = false;

  constructor(options: ChatStoreOptions = {}) {
    this.dir = resolve(options.dir ?? DEFAULT_DIR);
  }

  /**
   * 创建一个新的聊天会话。
   * 如果 direct 类型且两人之间已有会话，返回现有会话（幂等）。
   */
  async createChat(
    participants: string[],
    type: ChatType = 'direct',
    title?: string,
  ): Promise<Chat> {
    await this.ensureDir();

    // direct 聊天：检查是否已存在
    if (type === 'direct' && participants.length === 2) {
      const [p1, p2] = participants;
      if (p1 !== undefined && p2 !== undefined) {
        const existing = await this.findDirectChat(p1, p2);
        if (existing) return existing;
      }
    }

    const now = Date.now();
    const chat: Chat = {
      id: randomUUID(),
      type,
      participants: [...participants],
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...(title ? { title } : {}),
    };

    await this._save({ chat, messages: [] });
    return chat;
  }

  /** 根据 ID 获取会话元信息 */
  async getChat(chatId: string): Promise<Chat | null> {
    const file = await this._load(chatId);
    return file?.chat ?? null;
  }

  /** 列出所有会话，可按参与者过滤 */
  async listChats(participantId?: string): Promise<Chat[]> {
    await this.ensureDir();
    const files = await readdir(this.dir);
    const chatIds = files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

    const chats: Chat[] = [];
    for (const id of chatIds) {
      const file = await this._load(id);
      if (!file) continue;
      if (participantId && !file.chat.participants.includes(participantId)) continue;
      chats.push(file.chat);
    }

    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 发送一条消息到指定会话（异步，不等待接收方处理）。
   * 自动更新会话的 updatedAt 和 lastMessage 预览。
   */
  async sendMessage(
    chatId: string,
    from: string,
    content: string,
    options: {
      replyToId?: string;
      taskId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<ChatMessage> {
    const file = await this._load(chatId);
    if (!file) throw new Error(`Chat not found: ${chatId}`);

    const message: ChatMessage = {
      id: randomUUID(),
      chatId,
      from,
      content,
      timestamp: Date.now(),
      status: 'sent' as ChatMessageStatus,
      ...(options.replyToId ? { replyToId: options.replyToId } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };

    file.messages.push(message);
    file.chat.updatedAt = message.timestamp;
    file.chat.lastMessage = content.length > 80 ? content.slice(0, 80) + '…' : content;

    await this._save(file);
    return message;
  }

  /**
   * 获取会话的消息历史。
   * @param limit 最多返回最新的 N 条，默认返回全部
   */
  async getMessages(chatId: string, limit?: number): Promise<ChatMessage[]> {
    const file = await this._load(chatId);
    if (!file) return [];
    const msgs = file.messages;
    return limit ? msgs.slice(-limit) : [...msgs];
  }

  /**
   * 获取指定参与者在某个会话中的未读消息。
   * 未读 = status 不是 'read' 且发送方不是自己。
   */
  async getUnreadMessages(chatId: string, participantId: string): Promise<ChatMessage[]> {
    const messages = await this.getMessages(chatId);
    return messages.filter(m => m.from !== participantId && m.status !== 'read');
  }

  /**
   * 获取某个参与者在所有会话中的全部未读消息，按时间排序。
   */
  async getAllUnread(participantId: string): Promise<Array<{ chat: Chat; message: ChatMessage }>> {
    const chats = await this.listChats(participantId);
    const result: Array<{ chat: Chat; message: ChatMessage }> = [];

    for (const chat of chats) {
      if (chat.status === 'archived') continue;
      const unread = await this.getUnreadMessages(chat.id, participantId);
      for (const message of unread) {
        result.push({ chat, message });
      }
    }

    return result.sort((a, b) => a.message.timestamp - b.message.timestamp);
  }

  /**
   * 将某个会话中某参与者的所有未读消息标记为已读。
   */
  async markRead(chatId: string, participantId: string): Promise<void> {
    const file = await this._load(chatId);
    if (!file) return;

    let changed = false;
    for (const msg of file.messages) {
      if (msg.from !== participantId && msg.status !== 'read') {
        msg.status = 'read';
        changed = true;
      }
    }

    if (changed) await this._save(file);
  }

  /** 更新消息状态（例如从 sent → delivered） */
  async updateMessageStatus(
    chatId: string,
    messageId: string,
    status: ChatMessageStatus,
  ): Promise<void> {
    const file = await this._load(chatId);
    if (!file) return;

    const msg = file.messages.find(m => m.id === messageId);
    if (msg) {
      msg.status = status;
      await this._save(file);
    }
  }

  /** 归档会话（不删除历史记录） */
  async archiveChat(chatId: string): Promise<void> {
    const file = await this._load(chatId);
    if (!file) return;
    file.chat.status = 'archived';
    await this._save(file);
  }

  // ─── 私有工具 ────────────────────────────────────────────────────────────────

  private async findDirectChat(a: string, b: string): Promise<Chat | null> {
    const chats = await this.listChats(a);
    return chats.find(c =>
      c.type === 'direct' &&
      c.participants.length === 2 &&
      c.participants.includes(b) &&
      c.status === 'active',
    ) ?? null;
  }

  private async _load(chatId: string): Promise<ChatFile | null> {
    const path = this._pathFor(chatId);
    if (!(await this._exists(path))) return null;
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as ChatFile;
    } catch {
      return null;
    }
  }

  private async _save(file: ChatFile): Promise<void> {
    await this.ensureDir();
    const path = this._pathFor(file.chat.id);
    await writeFile(path, JSON.stringify(file, null, 2), 'utf-8');
  }

  private _pathFor(chatId: string): string {
    return join(this.dir, `${sanitizeId(chatId)}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    this.initialized = true;
  }

  private async _exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}

function sanitizeId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9\-_]/g, '_');
  if (safe !== id) {
    const hash = id
      .split('')
      .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0)
      .toString(16)
      .padStart(4, '0');
    return `${safe}_${hash}`;
  }
  return safe;
}
