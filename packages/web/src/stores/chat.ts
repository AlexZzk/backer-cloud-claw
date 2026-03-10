import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { sessionsApi, dmApi, sendMessageStream, type ApiSession, type ApiMessage, type SessionType } from '@/api/client';
import { useWorkersStore } from './workers';

export type { ApiMessage as MockMessage };

export interface ChatSession {
  id: string;
  type: SessionType;
  workerId: string;
  toWorkerId?: string;    // 仅 DM 会话有
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ApiMessage[];
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([]);
  const activeWorkerId = ref<string | null>(null);
  const activeSessionId = ref<string | null>(null);
  const isThinking = ref(false);
  const loading = ref(false);

  // ─── Computed ───────────────────────────────────────────────────────────

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null
  );

  /** 用户↔Worker 会话列表（按 worker 分组，供联系人栏展示） */
  const contactList = computed(() => {
    const workersStore = useWorkersStore();
    return workersStore.workers.map(worker => {
      const workerSessions = sessions.value
        .filter(s => s.type === 'chat' && s.workerId === worker.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = workerSessions[0];
      const lastMsg = latest?.messages[latest.messages.length - 1];
      return {
        worker,
        latestSession: latest ?? null,
        lastMessage: lastMsg?.content.slice(0, 50) ?? '',
        updatedAt: latest?.updatedAt ?? 0,
        sessionCount: workerSessions.length,
      };
    }).sort((a, b) => {
      if (a.worker.isPrimary) return -1;
      if (b.worker.isPrimary) return 1;
      return b.updatedAt - a.updatedAt;
    });
  });

  /** Worker↔Worker DM 会话列表（供 DM 区域展示） */
  const dmList = computed(() =>
    sessions.value
      .filter(s => s.type === 'dm')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  // ─── Actions ────────────────────────────────────────────────────────────

  function getWorkerSessions(workerId: string): ChatSession[] {
    return sessions.value
      .filter(s => s.type === 'chat' && s.workerId === workerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function selectWorker(workerId: string) {
    activeWorkerId.value = workerId;
    const workerSessions = getWorkerSessions(workerId);
    activeSessionId.value = workerSessions[0]?.id ?? null;
  }

  function selectSession(sessionId: string) {
    activeSessionId.value = sessionId;
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) activeWorkerId.value = session.workerId;
  }

  async function newSession(workerId: string): Promise<ChatSession> {
    loading.value = true;
    try {
      const apiSession = await sessionsApi.create(workerId);
      const session = fromApiSession(apiSession);
      sessions.value.unshift(session);
      activeWorkerId.value = workerId;
      activeSessionId.value = session.id;
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
    session.updatedAt = Date.now();
    if (session.messages.length === 1) {
      session.title = content.trim().slice(0, 24);
    }

    isThinking.value = true;

    if (isDm) {
      // DM 会话：等待 speaker 事件逐条追加两个 worker 的消息
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
  }

  function openWorkerChat(workerId: string) {
    selectWorker(workerId);
  }

  return {
    sessions, activeWorkerId, activeSessionId, activeSession,
    isThinking, loading, contactList, dmList,
    getWorkerSessions, selectWorker, selectSession,
    newSession, newDmSession, deleteSession, sendMessage, clearSession, openWorkerChat,
  };
});

// ─── 工具 ────────────────────────────────────────────────────────────────────

function fromApiSession(s: ApiSession): ChatSession {
  return {
    id:          s.id,
    type:        s.type,
    workerId:    s.workerId,
    toWorkerId:  s.toWorkerId,
    title:       s.title,
    createdAt:   s.createdAt,
    updatedAt:   s.updatedAt,
    messages:    [],
  };
}
