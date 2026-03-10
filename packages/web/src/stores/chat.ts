import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  MOCK_CONVERSATIONS, MOCK_WORKERS,
  type MockConversation, type MockMessage, type MockWorker,
} from '@/mock/data';

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<MockConversation[]>([...MOCK_CONVERSATIONS]);
  const activeConvId = ref<string | null>(conversations.value[0]?.id ?? null);
  const isThinking = ref(false);

  const activeConv = computed(() =>
    conversations.value.find(c => c.id === activeConvId.value) ?? null
  );

  const workers = ref<MockWorker[]>([...MOCK_WORKERS]);

  function selectConv(id: string) {
    activeConvId.value = id;
  }

  function createConv(workerId: string) {
    const worker = workers.value.find(w => w.id === workerId);
    if (!worker) return;

    const conv: MockConversation = {
      id: `conv-${Date.now()}`,
      workerId,
      workerName: worker.name,
      title: '新对话',
      lastMessage: '',
      updatedAt: Date.now(),
      messages: [],
    };
    conversations.value.unshift(conv);
    activeConvId.value = conv.id;
    return conv;
  }

  async function sendMessage(content: string) {
    if (!activeConv.value || !content.trim()) return;

    const userMsg: MockMessage = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };
    activeConv.value.messages.push(userMsg);
    activeConv.value.lastMessage = content.trim();
    activeConv.value.updatedAt = Date.now();
    if (activeConv.value.messages.length === 1) {
      activeConv.value.title = content.trim().slice(0, 20);
    }

    isThinking.value = true;

    // Simulate streaming response
    await new Promise(r => setTimeout(r, 800 + Math.random() * 800));

    const responses = [
      '这是一个很好的问题！让我来详细解答...\n\n根据您的需求，我建议采用以下方案：\n\n1. 首先分析问题的核心需求\n2. 然后制定可行的解决方案\n3. 最后进行实施和验证\n\n如果您需要更多细节，请随时告诉我。',
      '明白了，我来帮您处理这个任务。\n\n```typescript\n// 示例代码\nconst solution = async () => {\n  const result = await processData(input);\n  return result;\n};\n```\n\n以上代码展示了基本思路，您可以根据实际情况进行调整。',
      '这是一个复杂但有趣的问题。从我的分析来看：\n\n**关键点：**\n- 性能是首要考量\n- 可维护性同样重要\n- 需要考虑扩展性\n\n我推荐分阶段实施，这样可以降低风险并保证质量。',
    ];

    const assistantMsg: MockMessage = {
      id: `m-${Date.now() + 1}`,
      role: 'assistant',
      content: responses[Math.floor(Math.random() * responses.length)] || responses[0]!,
      timestamp: Date.now(),
      tokenUsage: {
        inputTokens: Math.floor(Math.random() * 50) + 20,
        outputTokens: Math.floor(Math.random() * 200) + 100,
      },
    };

    isThinking.value = false;
    activeConv.value.messages.push(assistantMsg);
    activeConv.value.lastMessage = assistantMsg.content.slice(0, 50);
    activeConv.value.updatedAt = Date.now();
  }

  function clearHistory() {
    if (!activeConv.value) return;
    activeConv.value.messages = [];
    activeConv.value.lastMessage = '';
  }

  function deleteConv(id: string) {
    const idx = conversations.value.findIndex(c => c.id === id);
    if (idx >= 0) {
      conversations.value.splice(idx, 1);
      if (activeConvId.value === id) {
        activeConvId.value = conversations.value[0]?.id ?? null;
      }
    }
  }

  return {
    conversations, activeConvId, activeConv, isThinking, workers,
    selectConv, createConv, sendMessage, clearHistory, deleteConv,
  };
});
