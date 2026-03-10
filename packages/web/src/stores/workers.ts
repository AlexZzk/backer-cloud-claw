import { defineStore } from 'pinia';
import { ref } from 'vue';
import { workersApi, type ApiWorker } from '@/api/client';

export type { ApiWorker as MockWorker };

export const useWorkersStore = defineStore('workers', () => {
  const workers = ref<ApiWorker[]>([]);
  const loading = ref(false);

  async function fetchWorkers() {
    loading.value = true;
    try {
      workers.value = await workersApi.list();
    } catch {
      // 后端不可用时保持空列表
      workers.value = [];
    } finally {
      loading.value = false;
    }
  }

  function getWorker(id: string): ApiWorker | undefined {
    return workers.value.find(w => w.id === id);
  }

  const AVAILABLE_MODELS = [
    { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6 (最强)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (推荐)' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (快速)' },
    { id: 'gpt-4o',            label: 'GPT-4o' },
    { id: 'gpt-4o-mini',       label: 'GPT-4o Mini' },
  ];

  const AVAILABLE_TOOLS = [
    { id: 'datetime',   label: '获取当前时间' },
    { id: 'file-read',  label: '读取文件' },
    { id: 'file-write', label: '写入文件' },
    { id: 'web-fetch',  label: '获取网页内容' },
    { id: 'shell-exec', label: '执行 Shell 命令' },
  ];

  return {
    workers, loading,
    fetchWorkers, getWorker,
    AVAILABLE_MODELS, AVAILABLE_TOOLS,
  };
});
