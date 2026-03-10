import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { sessionsApi, sendMessageStream, type ApiSession, type ApiMessage } from '@/api/client';
import { useWorkersStore } from './workers';

export type { ApiMessage as MockMessage };

export interface ChatSession {
  id: string;
  workerId: string;
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

  const contactList = computed(() => {
    const workersStore = useWorkersStore();
    return workersStore.workers.map(worker => {
      const workerSessions = sessions.value
        .filter(s => s.workerId === worker.id)
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

  // ─── Actions ────────────────────────────────────────────────────────────

  function getWorkerSessions(workerId: string): ChatSession[] {
    return sessions.value
      .filter(s => s.workerId === workerId)
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
      const session: ChatSession = {
        id: apiSession.id,
        workerId: apiSession.workerId,
        title: apiSession.title,
        createdAt: apiSession.createdAt,
        updatedAt: apiSession.updatedAt,
        messages: [],
      };
      sessions.value.unshift(session);
      activeWorkerId.value = workerId;
      activeSessionId.value = session.id;
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
    } catch {
      // 忽略后端错误，本地直接删除
    }
    sessions.value.splice(idx, 1);
    if (activeSessionId.value === sessionId) {
      const remaining = getWorkerSessions(workerId);
      activeSessionId.value = remaining[0]?.id ?? null;
    }
  }

  async function sendMessage(content: string) {
    if (!activeSession.value || !content.trim()) return;

    const session = activeSession.value;

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

    // assistant 占位消息（流式追加内容）
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

  function clearSession() {
    if (!activeSession.value) return;
    activeSession.value.messages = [];
  }

  function openWorkerChat(workerId: string) {
    selectWorker(workerId);
  }

  return {
    sessions, activeWorkerId, activeSessionId, activeSession,
    isThinking, loading, contactList,
    getWorkerSessions, selectWorker, selectSession,
    newSession, deleteSession, sendMessage, clearSession, openWorkerChat,
  };
});
