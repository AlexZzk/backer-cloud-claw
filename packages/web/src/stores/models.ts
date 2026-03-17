import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { modelsApi, type ApiModel, type ApiModelInput } from '@/api/client';

export type ModelProtocol = 'anthropic' | 'openai' | 'openai-compatible';

// 前端展示用的模型格式（兼容 Settings 页面的编辑功能）
export interface ConfiguredModel {
  id: string;
  displayName: string;
  modelId: string;
  protocol: ModelProtocol;
  apiKey: string;   // 后端不返回明文 key，始终为空字符串
  baseUrl?: string;
  isDefault: boolean;
  insecure?: boolean;
  noProxy?: string;
}

const PROTOCOL_MAP: Record<string, ModelProtocol> = {
  claude:   'anthropic',
  openai:   'openai',
  deepseek: 'openai-compatible',
  bailian:  'openai-compatible',
  custom:   'openai-compatible',
};

const PROVIDER_MAP: Record<ModelProtocol, string> = {
  anthropic:          'claude',
  openai:             'openai',
  'openai-compatible': 'custom',
};

function apiModelToConfigured(m: ApiModel): ConfiguredModel {
  return {
    id:          m.id,
    displayName: `${m.id}${m.model ? ` (${m.model})` : ''}`,
    modelId:     m.model ?? m.id,
    protocol:    PROTOCOL_MAP[m.provider] ?? 'openai',
    apiKey:      '',
    ...(m.baseUrl  && { baseUrl:  m.baseUrl }),
    ...(m.insecure && { insecure: m.insecure }),
    ...(m.noProxy  && { noProxy:  m.noProxy }),
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

  async function addModel(data: {
    id: string;
    modelId: string;
    protocol: ModelProtocol;
    apiKey: string;
    baseUrl?: string;
    insecure?: boolean;
    noProxy?: string;
  }): Promise<ConfiguredModel> {
    const input: ApiModelInput = {
      id:       data.id,
      provider: PROVIDER_MAP[data.protocol],
      apiKey:   data.apiKey,
      model:    data.modelId || undefined,
      baseUrl:  data.baseUrl || undefined,
      isPrimary: models.value.length === 0, // 第一个模型自动设为默认
      ...(data.insecure && { insecure: true }),
      ...(data.noProxy  && { noProxy:  data.noProxy }),
    };
    const created = await modelsApi.create(input);
    const cm = apiModelToConfigured(created);
    if (cm.isDefault) models.value.forEach(m => { m.isDefault = false; });
    models.value.push(cm);
    return cm;
  }

  async function updateModel(id: string, data: {
    modelId?: string;
    protocol?: ModelProtocol;
    apiKey?: string;
    baseUrl?: string;
    insecure?: boolean;
    noProxy?: string;
  }): Promise<ConfiguredModel> {
    const input: Partial<ApiModelInput> = {};
    if (data.protocol !== undefined) input.provider = PROVIDER_MAP[data.protocol];
    if (data.modelId  !== undefined) input.model    = data.modelId  || undefined;
    if (data.apiKey   !== undefined) input.apiKey   = data.apiKey;   // 空 = 不修改
    if (data.baseUrl  !== undefined) input.baseUrl  = data.baseUrl  || undefined;
    if (data.insecure !== undefined) input.insecure = data.insecure;
    if (data.noProxy  !== undefined) input.noProxy  = data.noProxy  || undefined;

    const updated = await modelsApi.update(id, input);
    const cm = apiModelToConfigured(updated);
    const idx = models.value.findIndex(m => m.id === id);
    if (idx >= 0) models.value[idx] = cm;
    return cm;
  }

  async function deleteModel(id: string): Promise<void> {
    await modelsApi.delete(id);
    const idx = models.value.findIndex(m => m.id === id);
    if (idx < 0) return;
    const wasDefault = models.value[idx]!.isDefault;
    models.value.splice(idx, 1);
    if (wasDefault && models.value.length > 0) {
      models.value[0]!.isDefault = true;
    }
  }

  async function setDefault(id: string): Promise<void> {
    await modelsApi.update(id, { isPrimary: true });
    models.value.forEach(m => { m.isDefault = m.id === id; });
  }

  return {
    models, defaultModel, loading,
    fetchModels, addModel, updateModel, deleteModel, setDefault,
  };
});
