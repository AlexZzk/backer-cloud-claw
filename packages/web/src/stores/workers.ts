import { defineStore } from 'pinia';
import { ref } from 'vue';
import { MOCK_WORKERS, type MockWorker } from '@/mock/data';

export const useWorkersStore = defineStore('workers', () => {
  const workers = ref<MockWorker[]>([...MOCK_WORKERS]);
  const loading = ref(false);

  function getWorker(id: string): MockWorker | undefined {
    return workers.value.find(w => w.id === id);
  }

  function createWorker(data: Omit<MockWorker, 'id' | 'totalTokens' | 'totalSessions' | 'lastActive' | 'status'>): MockWorker {
    const worker: MockWorker = {
      ...data,
      id: `w-${Date.now()}`,
      status: 'offline',
      totalTokens: 0,
      totalSessions: 0,
      lastActive: '从未',
    };
    workers.value.unshift(worker);
    return worker;
  }

  function updateWorker(id: string, data: Partial<MockWorker>) {
    const idx = workers.value.findIndex(w => w.id === id);
    if (idx >= 0) {
      workers.value[idx] = { ...workers.value[idx]!, ...data };
    }
  }

  function deleteWorker(id: string) {
    const idx = workers.value.findIndex(w => w.id === id);
    if (idx >= 0) workers.value.splice(idx, 1);
  }

  const AVAILABLE_MODELS = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (最强)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (推荐)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (快速)' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ];

  const AVAILABLE_TOOLS = [
    { id: 'datetime', label: '获取当前时间' },
    { id: 'file-read', label: '读取文件' },
    { id: 'file-write', label: '写入文件' },
    { id: 'web-fetch', label: '获取网页内容' },
    { id: 'shell-exec', label: '执行 Shell 命令' },
  ];

  return {
    workers, loading,
    getWorker, createWorker, updateWorker, deleteWorker,
    AVAILABLE_MODELS, AVAILABLE_TOOLS,
  };
});
