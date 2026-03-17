import { defineStore } from 'pinia';
import { ref } from 'vue';
import { workersApi, type ApiWorker, type ApiWorkerInput } from '@/api/client';

export type { ApiWorker as MockWorker };

export const useWorkersStore = defineStore('workers', () => {
  const workers = ref<ApiWorker[]>([]);
  const loading = ref(false);

  async function fetchWorkers() {
    loading.value = true;
    try {
      workers.value = await workersApi.list();
    } catch {
      workers.value = [];
    } finally {
      loading.value = false;
    }
  }

  function getWorker(id: string): ApiWorker | undefined {
    return workers.value.find(w => w.id === id);
  }

  async function createWorker(data: ApiWorkerInput): Promise<ApiWorker> {
    const created = await workersApi.create(data);
    workers.value.push(created);
    return created;
  }

  async function updateWorker(id: string, data: Partial<ApiWorkerInput>): Promise<ApiWorker> {
    const updated = await workersApi.update(id, data);
    const idx = workers.value.findIndex(w => w.id === id);
    if (idx >= 0) workers.value[idx] = updated;
    // 若变更了 primary，同步清除其他 worker 的标记
    if (updated.isPrimary) {
      workers.value.forEach(w => { if (w.id !== id) w.isPrimary = false; });
    }
    return updated;
  }

  async function deleteWorker(id: string): Promise<void> {
    await workersApi.delete(id);
    const idx = workers.value.findIndex(w => w.id === id);
    if (idx >= 0) workers.value.splice(idx, 1);
  }

  const AVAILABLE_TOOLS = [
    { id: 'datetime',   label: '获取当前时间' },
    { id: 'file-read',  label: '读取文件' },
    { id: 'file-write', label: '写入文件' },
    { id: 'web-fetch',  label: '获取网页内容' },
    { id: 'shell-exec', label: '执行 Shell 命令' },
  ];

  /**
   * 根据 SSE worker:state:changed 事件直接更新状态，无需重新请求。
   * lifecycleState: 'idle' | 'processing' | 'sleeping' | 'blocked'
   */
  function applyStateChange(workerId: string, lifecycleState: string): void {
    const w = workers.value.find(w => w.id === workerId);
    if (!w) return;
    w.status = lifecycleState === 'processing' ? 'busy' : 'online';
  }

  return {
    workers, loading,
    fetchWorkers, getWorker,
    createWorker, updateWorker, deleteWorker,
    applyStateChange,
    AVAILABLE_TOOLS,
  };
});
