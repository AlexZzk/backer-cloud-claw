import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ModelProtocol = 'anthropic' | 'openai' | 'openai-compatible';

export interface ConfiguredModel {
  id: string;
  displayName: string;
  modelId: string;
  protocol: ModelProtocol;
  apiKey: string;
  baseUrl?: string;
  isDefault: boolean;
}

const MOCK_MODELS: ConfiguredModel[] = [
  {
    id: 'm-1',
    displayName: 'Claude Sonnet 4.6',
    modelId: 'claude-sonnet-4-6',
    protocol: 'anthropic',
    apiKey: 'sk-ant-api03-xxxxxxxxxxxxxxxx',
    isDefault: true,
  },
  {
    id: 'm-2',
    displayName: 'Claude Haiku 4.5',
    modelId: 'claude-haiku-4-5-20251001',
    protocol: 'anthropic',
    apiKey: 'sk-ant-api03-xxxxxxxxxxxxxxxx',
    isDefault: false,
  },
  {
    id: 'm-3',
    displayName: 'GPT-4o',
    modelId: 'gpt-4o',
    protocol: 'openai',
    apiKey: '',
    isDefault: false,
  },
];

export const useModelsStore = defineStore('models', () => {
  const models = ref<ConfiguredModel[]>([...MOCK_MODELS]);

  const defaultModel = computed(() =>
    models.value.find(m => m.isDefault) ?? models.value[0] ?? null
  );

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
    models, defaultModel,
    addModel, updateModel, deleteModel, setDefault,
  };
});
