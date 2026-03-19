import { EventEmitter } from 'node:events';
import type { Chat, ChatMessage, ChatType, OrgEvent } from '@bcc/foundation';
import { ChatStore } from './chat-store.js';

export interface MessagingServiceOptions {
  store: ChatStore;
  /** 共享的事件总线（通常来自 Company） */
  eventBus?: EventEmitter;
}

/**
 * MessagingService：Worker 间异步通信的核心服务。
 *
 * 核心设计理念（类比飞书/微信）：
 * - 发送消息是异步的"留言"：发完继续干自己的事，不阻塞等待回复
 * - 接收方在自己的"工作审视周期"中读取并处理未读消息
 * - 所有对话永久存档，可随时回溯
 *
 * 与旧的 Company.send() 的对比：
 * - send()    → 同步阻塞，Worker1 等 Worker2 处理完才能继续
 * - post()    → 异步投递，Worker1 投完即返回，Worker2 独立处理
 */
export class MessagingService {
  private store: ChatStore;
  private eventBus: EventEmitter;

  constructor(options: MessagingServiceOptions) {
    this.store = options.store;
    this.eventBus = options.eventBus ?? new EventEmitter();
  }

  /**
   * 打开（或获取）两个参与者之间的私聊会话。
   * 幂等：如果已存在 active 的直聊，直接返回现有会话。
   */
  async openDirectChat(participant1: string, participant2: string): Promise<Chat> {
    const chat = await this.store.createChat([participant1, participant2], 'direct');
    this.eventBus.emit('org:event', {
      type: 'chat:opened',
      chat,
    } satisfies OrgEvent);
    return chat;
  }

  /**
   * 创建一个多人群聊会话。
   */
  async createGroupChat(participants: string[], title?: string): Promise<Chat> {
    const chat = await this.store.createChat(participants, 'group', title);
    this.eventBus.emit('org:event', {
      type: 'chat:opened',
      chat,
    } satisfies OrgEvent);
    return chat;
  }

  /**
   * 异步发送消息（不等待接收方处理）。
   *
   * 核心行为：
   * 1. 消息立即持久化到 ChatStore
   * 2. 触发 org:event 事件（订阅方可实时感知）
   * 3. 返回已存储的 ChatMessage（含 ID、时间戳）
   * 4. 不关心接收方何时处理此消息
   */
  async post(
    chatId: string,
    from: string,
    content: string,
    options: {
      replyToId?: string;
      taskId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<ChatMessage> {
    const message = await this.store.sendMessage(chatId, from, content, options);

    this.eventBus.emit('org:event', {
      type: 'chat:message:sent',
      chatId,
      message,
    } satisfies OrgEvent);

    return message;
  }

  /**
   * 获取某参与者的全部未读消息（跨所有活跃会话），按时间升序。
   * Worker 在"审视周期"中调用此方法来获取待处理消息。
   */
  async getPendingMessages(
    participantId: string,
  ): Promise<Array<{ chat: Chat; message: ChatMessage }>> {
    return this.store.getAllUnread(participantId);
  }

  /**
   * 将某会话的消息标记为已读（Worker 处理完消息后调用）。
   */
  async markRead(chatId: string, participantId: string): Promise<void> {
    await this.store.markRead(chatId, participantId);
  }

  /** 获取会话列表 */
  async listChats(participantId?: string): Promise<Chat[]> {
    return this.store.listChats(participantId);
  }

  /** 获取会话消息历史 */
  async getMessages(chatId: string, limit?: number): Promise<ChatMessage[]> {
    return this.store.getMessages(chatId, limit);
  }

  /** 获取会话元信息 */
  async getChat(chatId: string): Promise<Chat | null> {
    return this.store.getChat(chatId);
  }

  /** 归档会话 */
  async archiveChat(chatId: string): Promise<void> {
    await this.store.archiveChat(chatId);
    this.eventBus.emit('org:event', {
      type: 'chat:archived',
      chatId,
    } satisfies OrgEvent);
  }

  /**
   * 获取会话摘要（Token 优化用）。
   * 返回 null 表示尚无摘要（首次交互）。
   */
  async getChatSummary(chatId: string): Promise<string | null> {
    return this.store.getChatSummary(chatId);
  }

  /**
   * 更新会话摘要（Token 优化用）。
   * Worker 处理完消息后调用，供后续 processInbox() 减少 context 加载量。
   */
  async updateChatSummary(chatId: string, summary: string): Promise<void> {
    await this.store.updateChatSummary(chatId, summary);
  }
}
