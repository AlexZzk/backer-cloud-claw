import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  MOCK_SESSIONS, MOCK_WORKERS,
  type MockSession, type MockMessage,
} from '@/mock/data';

export const useChatStore = defineStore('chat', () => {
  // All sessions across all workers
  const sessions = ref<MockSession[]>([...MOCK_SESSIONS]);

  // Active state: which worker contact is open, and which session within it
  const activeWorkerId = ref<string | null>('w-secretary');
  const activeSessionId = ref<string | null>('sess-secretary-1');

  const isThinking = ref(false);

  // ─── Computed ───────────────────────────────────────────────────────────

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null
  );

  // Contact list: one row per worker, sorted by most recent session
  const contactList = computed(() => {
    return MOCK_WORKERS.map(worker => {
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
      // Secretary always first
      if (a.worker.isSecretary) return -1;
      if (b.worker.isSecretary) return 1;
      return b.updatedAt - a.updatedAt;
    });
  });

  // Sessions for a specific worker
  function getWorkerSessions(workerId: string): MockSession[] {
    return sessions.value
      .filter(s => s.workerId === workerId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  function selectWorker(workerId: string) {
    activeWorkerId.value = workerId;
    const workerSessions = getWorkerSessions(workerId);
    activeSessionId.value = workerSessions[0]?.id ?? null;
  }

  function selectSession(sessionId: string) {
    activeSessionId.value = sessionId;
  }

  function newSession(workerId: string): MockSession {
    const session: MockSession = {
      id: `sess-${workerId}-${Date.now()}`,
      workerId,
      title: '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    sessions.value.unshift(session);
    activeWorkerId.value = workerId;
    activeSessionId.value = session.id;
    return session;
  }

  function deleteSession(sessionId: string) {
    const idx = sessions.value.findIndex(s => s.id === sessionId);
    if (idx < 0) return;
    const workerId = sessions.value[idx]!.workerId;
    sessions.value.splice(idx, 1);
    if (activeSessionId.value === sessionId) {
      const remaining = getWorkerSessions(workerId);
      activeSessionId.value = remaining[0]?.id ?? null;
    }
  }

  async function sendMessage(content: string) {
    if (!activeSession.value || !content.trim()) return;

    const userMsg: MockMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };
    activeSession.value.messages.push(userMsg);
    activeSession.value.updatedAt = Date.now();
    if (activeSession.value.messages.length === 1) {
      activeSession.value.title = content.trim().slice(0, 24);
    }

    isThinking.value = true;
    await new Promise(r => setTimeout(r, 700 + Math.random() * 900));

    const responses = [
      '这是一个很好的问题！让我来详细解答...\n\n根据您的需求，我建议采用以下方案：\n\n1. 首先分析问题的核心需求\n2. 然后制定可行的解决方案\n3. 最后进行实施和验证\n\n如果您需要更多细节，请随时告诉我。',
      '明白了，我来帮您处理这个任务。\n\n```typescript\n// 示例代码\nconst solution = async () => {\n  const result = await processData(input);\n  return result;\n};\n```\n\n以上代码展示了基本思路，您可以根据实际情况进行调整。',
      '这是一个复杂但有趣的问题。从我的分析来看：\n\n**关键点：**\n- 性能是首要考量\n- 可维护性同样重要\n- 需要考虑扩展性\n\n我推荐分阶段实施，这样可以降低风险并保证质量。',
    ];

    const assistantMsg: MockMessage = {
      id: `m-${Date.now() + 1}`,
      role: 'assistant',
      content: responses[Math.floor(Math.random() * responses.length)]!,
      timestamp: Date.now(),
      tokenUsage: {
        inputTokens: Math.floor(Math.random() * 50) + 20,
        outputTokens: Math.floor(Math.random() * 200) + 100,
      },
    };

    isThinking.value = false;
    activeSession.value.messages.push(assistantMsg);
    activeSession.value.updatedAt = Date.now();
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
    isThinking, contactList,
    getWorkerSessions, selectWorker, selectSession,
    newSession, deleteSession, sendMessage, clearSession, openWorkerChat,
  };
});
