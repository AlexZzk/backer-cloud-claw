import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { modelsApi, type ApiModel } from '@/api/client';

export type ModelProtocol = 'anthropic' | 'openai' | 'openai-compatible';

// 前端展示用的模型格式（兼容 Settings 页面的编辑功能）
export interface ConfiguredModel {
  id: string;
  displayName: string;
  modelId: string;
  protocol: ModelProtocol;
  apiKey: string;
  baseUrl?: string;
  isDefault: boolean;
}

function apiModelToConfigured(m: ApiModel): ConfiguredModel {
  const protocolMap: Record<string, ModelProtocol> = {
    claude:   'anthropic',
    openai:   'openai',
    deepseek: 'openai-compatible',
    bailian:  'openai-compatible',
    custom:   'openai-compatible',
  };
  return {
    id:          m.id,
    displayName: `${m.id}${m.model ? ` (${m.model})` : ''}`,
    modelId:     m.model ?? m.id,
    protocol:    protocolMap[m.id] ?? 'openai',
    apiKey:      '',  // 后端不返回明文 key
    ...(m.baseUrl && { baseUrl: m.baseUrl }),
    isDefault:   m.isPrimary,
  };
}

export const useModelsStore = defineStore('models', () => {
  const models = ref<ConfiguredModel[]>([]);
  const loading = ref(false);

  const defaultModel = computed(() =>
    models.value.find(m => m.isDefault) ?? models.value[0] ?? null
  );

  async function fetchModels() {
    loading.value = true;
    try {
      const apiModels = await modelsApi.list();
      models.value = apiModels.map(apiModelToConfigured);
    } catch {
      models.value = [];
    } finally {
      loading.value = false;
    }
  }

  // 本地 CRUD（修改后需重启服务端才持久化，后续可扩展 PATCH /api/config）
  function addModel(data: Omit<ConfiguredModel, 'id' | 'isDefault'>): ConfiguredModel {
    const model: ConfiguredModel = {
      ...data,
      id: `m-${Date.now()}`,
      isDefault: models.value.length === 0,
    };
    models.value.push(model);
    return model;
  }

  function updateModel(id: string, data: Partial<Omit<ConfiguredModel, 'id'>>) {
    const idx = models.value.findIndex(m => m.id === id);
    if (idx >= 0) {
      models.value[idx] = { ...models.value[idx]!, ...data };
    }
  }

  function deleteModel(id: string) {
    const idx = models.value.findIndex(m => m.id === id);
    if (idx < 0) return;
    const wasDefault = models.value[idx]!.isDefault;
    models.value.splice(idx, 1);
    if (wasDefault && models.value.length > 0) {
      models.value[0]!.isDefault = true;
    }
  }

  function setDefault(id: string) {
    models.value.forEach(m => { m.isDefault = m.id === id; });
  }

  return {
    models, defaultModel, loading,
    fetchModels, addModel, updateModel, deleteModel, setDefault,
  };
});
