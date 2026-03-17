import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { sessionsApi, dmApi, groupApi, chatsApi, sendMessageStream, type ApiSession, type ApiMessage, type SessionType, type ApiAsyncChat, type ApiAsyncChatMessage } from '@/api/client';

/** 统一显示格式：将 ApiAsyncChatMessage 规范化为与 ApiMessage 兼容的消息 */
export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  speakerId?: string;
  /** 标记该消息来自异步通知渠道（Worker 主动 notify_user） */
  isNotify?: boolean;
}
import { useWorkersStore } from './workers';

export type { ApiMessage as MockMessage };

export interface ChatSession {
  id: string;
  type: SessionType;
  workerId: string;
  toWorkerId?: string;    // 仅 DM 会话有
  workerIds?: string[];   // 仅 group 会话有：所有参与 Worker IDs
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;   // 来自后端，用于判断会话是否有消息（未加载时）
  messages: ApiMessage[];
}

export type { ApiAsyncChat, ApiAsyncChatMessage };

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([]);
  const activeWorkerId = ref<string | null>(null);
  const activeSessionId = ref<string | null>(null);
  const isThinking = ref(false);
  const loading = ref(false);
  const sessionsLoaded = ref(false);  // 是否已完成初始加载

  // ─── Async chats（Worker 间异步消息，来自 send_message 工具）───────────────
  const asyncChats = ref<ApiAsyncChat[]>([]);
  const activeAsyncChatId = ref<string | null>(null);
  const activeAsyncChatMessages = ref<ApiAsyncChatMessage[]>([]);

  /** Worker → 用户 的主动通知消息（来自 notify_user 工具），用于在主聊天窗口展示 */
  const activeWorkerNotifyMessages = ref<NormalizedMessage[]>([]);

  // ─── Computed ───────────────────────────────────────────────────────────

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null
  );

  /**
   * 会话联系人列表（仅显示有聊天记录的 Worker - chat 类型）
   * 参考微信/飞书风格：只有实际发生过对话才会出现在列表中
   * group 会话单独在 groupSessionList 中展示，避免重复
   */
  const contactList = computed(() => {
    const workersStore = useWorkersStore();
    return workersStore.workers
      .map(worker => {
        // 只看 chat（单聊）会话
        const workerSessions = sessions.value
          .filter(s => s.type === 'chat' && s.workerId === worker.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const latest = workerSessions[0];
        const lastMsg = latest?.messages[latest.messages.length - 1];

        // 查找该 Worker 与用户的直接异步聊天（来自 notify_user）
        const directChat = userWorkerDirectChats.value.find(c => c.participants.includes(worker.id));
        const sessionUpdatedAt = latest?.updatedAt ?? 0;
        const directChatUpdatedAt = directChat?.updatedAt ?? 0;
        const updatedAt = Math.max(sessionUpdatedAt, directChatUpdatedAt);

        // 最新消息：取时间最近的来源
        let lastMessage = lastMsg?.content.slice(0, 50) ?? '';
        if (directChat?.lastMessage && directChatUpdatedAt > sessionUpdatedAt) {
          lastMessage = directChat.lastMessage.slice(0, 50);
        }

        return {
          worker,
          latestSession: latest ?? null,
          lastMessage,
          updatedAt,
          sessionCount: workerSessions.length,
          hasDirectChat: !!directChat,
        };
      })
      // 显示有会话记录 或 有 notify_user 直接消息的 Worker
      .filter(item =>
        item.hasDirectChat ||
        (item.latestSession !== null &&
          (item.latestSession.messages.length > 0 || item.latestSession.messageCount > 0))
      )
      .sort((a, b) => {
        if (a.worker.isPrimary) return -1;
        if (b.worker.isPrimary) return 1;
        return b.updatedAt - a.updatedAt;
      });
  });

  /** group 会话列表（用户与多 Worker 的群聊，独立区域展示） */
  const groupSessionList = computed(() =>
    sessions.value
      .filter(s => s.type === 'group')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  /** Worker↔Worker DM 会话列表（供 DM 区域展示） */
  const dmList = computed(() =>
    sessions.value
      .filter(s => s.type === 'dm')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  /**
   * Worker → 用户 的直聊（notify_user 产生的 type=direct 且包含 'user' 的聊天）
   * 这些消息应显示在"与我对话"的 Worker 聊天窗口中，而不是"员工间对话"
   */
  const userWorkerDirectChats = computed(() =>
    asyncChats.value.filter(c => c.type === 'direct' && c.participants.includes('user'))
  );

  /**
   * 员工间异步聊天列表（按更新时间降序）
   * 排除 Worker → 用户 的直聊（已合并到主聊天窗口）
   */
  const asyncChatList = computed(() =>
    [...asyncChats.value]
      .filter(c => !(c.type === 'direct' && c.participants.includes('user')))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  // ─── Actions ────────────────────────────────────────────────────────────

  function getWorkerSessions(workerId: string): ChatSession[] {
    return sessions.value
      .filter(s => s.type === 'chat' && s.workerId === workerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 从后端加载某会话的消息详情，填充到本地 session
   */
  async function loadSessionMessages(sessionId: string): Promise<void> {
    try {
      const detail = await sessionsApi.get(sessionId);
      const session = sessions.value.find(s => s.id === sessionId);
      if (session) {
        session.messages = detail.messages;
        session.messageCount = detail.messages.length;
        session.updatedAt = detail.updatedAt;
        if (detail.title && detail.title !== '新会话') {
          session.title = detail.title;
        }
      }
    } catch {
      // 加载失败则保留空消息列表
    }
  }

  /**
   * 启动时加载所有 Worker 的历史会话（在当前服务器进程内有效）
   * 只加载元信息（含 messageCount），不立即加载消息内容（懒加载）
   */
  async function fetchAllSessions(): Promise<void> {
    const workersStore = useWorkersStore();
    if (workersStore.workers.length === 0) return;
    loading.value = true;
    try {
      const results = await Promise.all(
        workersStore.workers.map(w =>
          sessionsApi.listByWorker(w.id).catch(() => [] as ApiSession[])
        )
      );
      for (const apiSessions of results) {
        for (const apiSession of apiSessions) {
          if (!sessions.value.find(s => s.id === apiSession.id)) {
            sessions.value.push(fromApiSession(apiSession));
          }
        }
      }
    } finally {
      loading.value = false;
      sessionsLoaded.value = true;
    }
  }

  /**
   * 选中某个 Worker 并打开其最新会话（如有），懒加载消息
   * 参考微信风格：每个联系人只有一个对话窗口
   * 同时加载来自 notify_user 的异步直聊消息（合并到同一窗口展示）
   */
  async function selectWorker(workerId: string): Promise<void> {
    activeWorkerId.value = workerId;
    activeAsyncChatId.value = null;  // 清除异步聊天选中状态
    const workerSessions = getWorkerSessions(workerId);
    const latestSession = workerSessions[0] ?? null;
    activeSessionId.value = latestSession?.id ?? null;

    // 懒加载消息：仅在未加载过时从后端获取
    if (latestSession && latestSession.messages.length === 0 && latestSession.messageCount > 0) {
      await loadSessionMessages(latestSession.id);
    }

    // 同时加载该 Worker 通过 notify_user 发给用户的异步消息
    await loadWorkerNotifyMessages(workerId);
  }

  /**
   * 加载指定 Worker 通过 notify_user 发给用户的异步直聊消息
   * 将 ApiAsyncChatMessage 规范化为统一的 NormalizedMessage 格式
   */
  async function loadWorkerNotifyMessages(workerId: string): Promise<void> {
    const directChat = userWorkerDirectChats.value.find(c => c.participants.includes(workerId));
    if (!directChat) {
      activeWorkerNotifyMessages.value = [];
      return;
    }
    try {
      const rawMessages = await chatsApi.getMessages(directChat.id);
      activeWorkerNotifyMessages.value = rawMessages.map(m => ({
        id: m.id,
        role: (m.from === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp,
        isNotify: true,
      }));
    } catch {
      activeWorkerNotifyMessages.value = [];
    }
  }

  function selectSession(sessionId: string) {
    activeSessionId.value = sessionId;
    activeAsyncChatId.value = null;
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) activeWorkerId.value = session.workerId;
  }

  async function newSession(workerId: string): Promise<ChatSession> {
    loading.value = true;
    try {
      const apiSession = await sessionsApi.create(workerId);
      // 幂等：如果后端返回的是已有会话，直接复用本地记录
      const existing = sessions.value.find(s => s.id === apiSession.id);
      if (existing) {
        activeWorkerId.value = workerId;
        activeSessionId.value = existing.id;
        return existing;
      }
      const session = fromApiSession(apiSession);
      sessions.value.unshift(session);
      activeWorkerId.value = workerId;
      activeSessionId.value = session.id;
      return session;
    } finally {
      loading.value = false;
    }
  }

  /** 创建用户↔多 Worker 群聊会话 */
  async function newGroupSession(workerIds: string[]): Promise<ChatSession> {
    loading.value = true;
    try {
      const apiSession = await groupApi.create(workerIds);
      const session = fromApiSession(apiSession);
      sessions.value.unshift(session);
      activeSessionId.value = session.id;
      // 设置 activeWorkerId 为第一个 worker（用于 header 显示）
      activeWorkerId.value = workerIds[0] ?? null;
      return session;
    } finally {
      loading.value = false;
    }
  }

  /** 创建或打开两个 Worker 之间的 DM 会话 */
  async function newDmSession(fromWorkerId: string, toWorkerId: string): Promise<ChatSession> {
    // 先检查本地是否已有
    const existing = sessions.value.find(
      s => s.type === 'dm' && (
        (s.workerId === fromWorkerId && s.toWorkerId === toWorkerId) ||
        (s.workerId === toWorkerId   && s.toWorkerId === fromWorkerId)
      ),
    );
    if (existing) {
      activeSessionId.value = existing.id;
      activeWorkerId.value = existing.workerId;
      return existing;
    }

    loading.value = true;
    try {
      const apiSession = await dmApi.create(fromWorkerId, toWorkerId);
      const session = fromApiSession(apiSession);
      sessions.value.unshift(session);
      activeSessionId.value = session.id;
      activeWorkerId.value = session.workerId;
      return session;
    } finally {
      loading.value = false;
    }
  }

  async function deleteSession(sessionId: string) {
    const idx = sessions.value.findIndex(s => s.id === sessionId);
    if (idx < 0) return;
    const workerId = sessions.value[idx]!.workerId;
    try {
      await sessionsApi.delete(sessionId);
    } catch { /* 忽略后端错误，本地直接删除 */ }
    sessions.value.splice(idx, 1);
    if (activeSessionId.value === sessionId) {
      const remaining = getWorkerSessions(workerId);
      activeSessionId.value = remaining[0]?.id ?? null;
    }
  }

  async function sendMessage(content: string) {
    if (!activeSession.value || !content.trim()) return;

    const session = activeSession.value;
    const isDm = session.type === 'dm';

    // 用户消息立即追加（乐观更新）
    const userMsg: ApiMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };
    session.messages.push(userMsg);
    session.messageCount = session.messages.length;
    session.updatedAt = Date.now();
    if (session.messages.length === 1) {
      session.title = content.trim().slice(0, 24);
    }

    isThinking.value = true;

    if (isDm || session.type === 'group') {
      // DM / group 会话：等待 speaker 事件逐条追加各 worker 的消息
      let currentSpeakerId: string | null = null;
      let currentMsg: ApiMessage | null = null;

      try {
        await sendMessageStream(session.id, content.trim(), {
          onSpeaker: (workerId) => {
            // 开始新的发言者，创建新消息占位
            currentSpeakerId = workerId;
            currentMsg = {
              id: `m-${Date.now()}-${workerId}`,
              role: 'assistant',
              speakerId: workerId,
              content: '',
              timestamp: Date.now(),
            };
            session.messages.push(currentMsg);
          },
          onChunk: (text) => {
            if (currentMsg) currentMsg.content += text;
          },
          onDone: () => {
            session.updatedAt = Date.now();
            session.messageCount = session.messages.length;
          },
          onError: (message) => {
            if (currentMsg) currentMsg.content = `⚠ 错误：${message}`;
          },
        });
      } finally {
        isThinking.value = false;
        void currentSpeakerId; // suppress unused warning
      }
    } else {
      // Chat 会话：单个 assistant 消息流式追加
      const assistantMsg: ApiMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      session.messages.push(assistantMsg);

      try {
        await sendMessageStream(session.id, content.trim(), {
          onChunk: (text) => {
            assistantMsg.content += text;
          },
          onDone: (tokenUsage) => {
            if (tokenUsage) {
              assistantMsg.tokenUsage = {
                inputTokens:  tokenUsage.inputTokens,
                outputTokens: tokenUsage.outputTokens,
              };
            }
            session.updatedAt = Date.now();
            session.messageCount = session.messages.length;
          },
          onError: (message) => {
            assistantMsg.content = `⚠ 错误：${message}`;
          },
        });
      } finally {
        isThinking.value = false;
      }
    }
  }

  function clearSession() {
    if (!activeSession.value) return;
    activeSession.value.messages = [];
    activeSession.value.messageCount = 0;
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    await sessionsApi.rename(sessionId, title);
    const s = sessions.value.find(x => x.id === sessionId);
    if (s) s.title = title;
  }

  function openWorkerChat(workerId: string) {
    void selectWorker(workerId);
  }

  // ─── 异步聊天操作 ──────────────────────────────────────────────────────────

  async function fetchAsyncChats(): Promise<void> {
    try {
      asyncChats.value = await chatsApi.list();
      // 如果当前有活跃 Worker，刷新其 notify 消息
      if (activeWorkerId.value) {
        await loadWorkerNotifyMessages(activeWorkerId.value);
      }
    } catch {
      asyncChats.value = [];
    }
  }

  async function selectAsyncChat(chatId: string): Promise<void> {
    // 清除 session 选中状态
    activeSessionId.value = null;
    activeWorkerId.value = null;
    activeAsyncChatId.value = chatId;
    activeAsyncChatMessages.value = [];
    try {
      activeAsyncChatMessages.value = await chatsApi.getMessages(chatId);
    } catch {
      activeAsyncChatMessages.value = [];
    }
  }

  return {
    sessions, activeWorkerId, activeSessionId, activeSession,
    isThinking, loading, sessionsLoaded, contactList, dmList, groupSessionList,
    asyncChats, asyncChatList, userWorkerDirectChats,
    activeAsyncChatId, activeAsyncChatMessages,
    activeWorkerNotifyMessages,
    getWorkerSessions, selectWorker, selectSession,
    newSession, newDmSession, newGroupSession, deleteSession, sendMessage, clearSession, renameSession, openWorkerChat,
    fetchAllSessions, loadSessionMessages,
    fetchAsyncChats, selectAsyncChat, loadWorkerNotifyMessages,
  };
});

// ─── 工具 ────────────────────────────────────────────────────────────────────

function fromApiSession(s: ApiSession): ChatSession {
  return {
    id:           s.id,
    type:         s.type,
    workerId:     s.workerId,
    toWorkerId:   s.toWorkerId,
    workerIds:    s.workerIds,
    title:        s.title,
    createdAt:    s.createdAt,
    updatedAt:    s.updatedAt,
    messageCount: s.messageCount,
    messages:     [],
  };
}
