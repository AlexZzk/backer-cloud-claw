<template>
  <div class="settings-view">
    <!-- Sub panel: settings sections -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('settings.title') }}</span>
      </div>
      <div class="settings-nav">
        <div
          v-for="section in sections"
          :key="section.id"
          class="sn-item"
          :class="{ active: activeSection === section.id }"
          @click="activeSection = section.id"
        >
          <span class="sn-icon">{{ section.icon }}</span>
          <span>{{ section.label }}</span>
        </div>
      </div>
    </div>

    <!-- Settings main -->
    <div class="settings-main">

      <!-- Profile -->
      <div v-if="activeSection === 'profile'" class="settings-section">
        <h2>{{ t('settings.profile') }}</h2>
        <div class="profile-avatar-section">
          <div class="profile-avatar">{{ authStore.user?.avatar || '👤' }}</div>
          <a-button size="small">{{ t('settings.changeAvatar') }}</a-button>
        </div>
        <a-form layout="vertical" style="max-width: 480px;">
          <a-form-item :label="t('settings.username')">
            <a-input v-model="profileForm.name" />
          </a-form-item>
          <a-form-item :label="t('settings.email')">
            <a-input v-model="profileForm.email" :disabled="true" />
          </a-form-item>
          <a-button type="primary" @click="saveProfile">{{ t('common.save') }}</a-button>
        </a-form>
      </div>

      <!-- Model Management -->
      <div v-if="activeSection === 'modelmgmt'" class="settings-section">
        <div class="section-header-row">
          <div>
            <h2>{{ t('settings.modelMgmt') }}</h2>
            <p class="section-desc">{{ t('settings.modelMgmtDesc') }}</p>
          </div>
          <a-button type="primary" @click="openAddModal">
            + {{ t('settings.addModel') }}
          </a-button>
        </div>

        <div class="model-list">
          <div
            v-for="model in modelsStore.models"
            :key="model.id"
            class="model-card"
            :class="{ 'is-default': model.isDefault }"
          >
            <div class="mc-top">
              <div class="mc-name-row">
                <span class="mc-name">{{ model.displayName }}</span>
                <a-tag v-if="model.isDefault" color="arcoblue" size="small">
                  {{ t('settings.defaultBadge') }}
                </a-tag>
              </div>
              <div class="mc-meta">
                <span class="mc-model-id">{{ model.modelId }}</span>
              </div>
            </div>

            <div class="mc-middle">
              <div class="mc-badge-row">
                <a-tag
                  :color="protocolColor(model.protocol)"
                  size="small"
                  class="mc-protocol-tag"
                >
                  {{ protocolLabel(model.protocol) }}
                </a-tag>
                <span class="mc-base-url" v-if="model.baseUrl">{{ model.baseUrl }}</span>
              </div>
              <div class="mc-key-row">
                <span class="mc-key-label">{{ t('settings.apiKey') }}:</span>
                <span v-if="model.apiKey" class="mc-key-val configured">
                  {{ maskKey(model.apiKey) }}
                </span>
                <span v-else class="mc-key-val unconfigured">
                  {{ t('settings.apiKeyEmpty') }}
                </span>
              </div>
            </div>

            <div class="mc-actions">
              <a-button
                v-if="!model.isDefault"
                size="small"
                type="outline"
                @click="modelsStore.setDefault(model.id)"
              >
                {{ t('settings.setDefault') }}
              </a-button>
              <a-button size="small" @click="openEditModal(model)">
                {{ t('common.edit') }}
              </a-button>
              <a-button
                size="small"
                status="danger"
                type="outline"
                :disabled="model.isDefault || modelDeleting === model.id"
                :loading="modelDeleting === model.id"
                @click="confirmDeleteModel(model.id)"
              >
                {{ t('common.delete') }}
              </a-button>
            </div>
          </div>

          <div v-if="modelsStore.models.length === 0" class="no-models">
            <p>{{ t('common.noData') }}</p>
            <a-button type="primary" @click="openAddModal">
              + {{ t('settings.addModel') }}
            </a-button>
          </div>
        </div>
      </div>

      <!-- Appearance -->
      <div v-if="activeSection === 'appearance'" class="settings-section">
        <h2>{{ t('settings.appearance') }}</h2>

        <div class="appearance-group">
          <div class="ag-label">{{ t('settings.theme') }}</div>
          <div class="theme-options">
            <div
              v-for="theme in themes"
              :key="theme.value"
              class="theme-option"
              :class="{ active: appStore.theme === theme.value }"
              @click="appStore.setTheme(theme.value as 'light' | 'dark')"
            >
              <div class="theme-preview" :class="theme.value">
                <div class="tp-sidebar"></div>
                <div class="tp-main">
                  <div class="tp-header"></div>
                  <div class="tp-content"></div>
                </div>
              </div>
              <span class="theme-name">{{ theme.label }}</span>
            </div>
          </div>
        </div>

        <a-divider />

        <div class="appearance-group">
          <div class="ag-label">{{ t('settings.language') }}</div>
          <div class="lang-options">
            <div
              class="lang-option"
              :class="{ active: appStore.locale === 'zh-CN' }"
              @click="appStore.changeLocale('zh-CN')"
            >
              <span class="lo-flag">🇨🇳</span>
              <span>中文</span>
            </div>
            <div
              class="lang-option"
              :class="{ active: appStore.locale === 'en-US' }"
              @click="appStore.changeLocale('en-US')"
            >
              <span class="lo-flag">🇺🇸</span>
              <span>English</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Storage Config -->
      <div v-if="activeSection === 'storage'" class="settings-section">
        <h2>{{ t('settings.storageConfig') }}</h2>
        <p class="section-desc">{{ t('settings.storageConfigDesc') }}</p>

        <a-form layout="vertical" style="max-width: 560px;">
          <a-form-item :label="t('settings.memoryStore')">
            <a-radio-group v-model="storageForm.memoryType" direction="vertical">
              <a-radio value="file">
                <div class="radio-option">
                  <span class="ro-title">📁 {{ t('settings.memoryFile') }}</span>
                  <span class="ro-desc">{{ t('settings.memoryFileDesc') }}</span>
                </div>
              </a-radio>
              <a-radio value="database">
                <div class="radio-option">
                  <span class="ro-title">🗄️ {{ t('settings.memoryDb') }}</span>
                  <span class="ro-desc">{{ t('settings.memoryDbDesc') }}</span>
                </div>
              </a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item :label="t('settings.dataDir')" v-if="storageForm.memoryType === 'file'">
            <a-input
              v-model="storageForm.dataDir"
              :placeholder="'~/.bcc/'"
              allow-clear
            >
              <template #prepend>📂</template>
            </a-input>
            <div class="form-hint">{{ t('settings.dataDirHint') }}</div>
          </a-form-item>

          <a-form-item :label="t('settings.dbUrl')" v-if="storageForm.memoryType === 'database'">
            <a-input
              v-model="storageForm.dbUrl"
              :placeholder="'postgresql://user:pass@localhost:5432/bcc'"
              allow-clear
            />
          </a-form-item>

          <a-divider />

          <a-form-item :label="t('settings.episodicMemory')">
            <a-switch v-model="storageForm.episodicEnabled" />
            <div class="form-hint">{{ t('settings.episodicMemoryHint') }}</div>
          </a-form-item>

          <a-form-item :label="t('settings.maxEpisodes')" v-if="storageForm.episodicEnabled">
            <a-input-number
              v-model="storageForm.maxEpisodes"
              :min="10" :max="500" :step="10"
              style="width: 160px"
            />
          </a-form-item>

          <a-form-item :label="t('settings.sessionDir')">
            <a-input
              v-model="storageForm.sessionDir"
              :placeholder="'~/.bcc/sessions/'"
            >
              <template #prepend>📂</template>
            </a-input>
          </a-form-item>

          <a-divider />

          <h3 style="margin: 0 0 12px; font-size: 14px; font-weight: 600;">{{ t('settings.workspaceConfig') }}</h3>
          <p class="section-desc" style="margin-bottom: 16px;">{{ t('settings.workspaceConfigDesc') }}</p>

          <a-form-item :label="t('settings.workspaceBaseDir')" :extra="t('settings.workspaceBaseDirHint')">
            <a-input
              v-model="storageForm.workspaceBaseDir"
              :placeholder="'~/.bcc/workspaces/'"
              allow-clear
            >
              <template #prepend>📁</template>
            </a-input>
          </a-form-item>

          <a-form-item :label="t('settings.sharedDir')" :extra="t('settings.sharedDirHint')">
            <a-input
              v-model="storageForm.sharedDir"
              :placeholder="'~/.bcc/shared/'"
              allow-clear
            >
              <template #prepend>📂</template>
            </a-input>
          </a-form-item>

          <a-button type="primary" @click="saveStorage">{{ t('common.save') }}</a-button>
        </a-form>

        <a-divider />

        <h3 style="margin: 0 0 8px;">对话列表自动刷新</h3>
        <p class="section-desc" style="margin-bottom: 12px;">定时刷新对话列表，获取 Worker 发来的最新通知消息。设为 0 可关闭自动刷新。</p>
        <div style="display: flex; align-items: center; gap: 12px;">
          <a-input-number
            v-model="chatRefreshInterval"
            :min="0"
            :max="3600"
            :step="5"
            style="width: 160px"
          />
          <span style="color: var(--text-secondary); font-size: 13px;">秒（0 = 关闭）</span>
          <a-button type="primary" @click="saveChatRefreshInterval">保存</a-button>
        </div>
      </div>

      <!-- About / Danger Zone -->
      <div v-if="activeSection === 'about'" class="settings-section">
        <h2>{{ t('settings.about') }}</h2>

        <div class="about-card">
          <div class="about-logo">⚡</div>
          <div class="about-info">
            <div class="about-name">BCC · backer-cloud-claw</div>
            <div class="about-ver">v0.1.0 — Interactive Prototype</div>
            <div class="about-desc">
              {{ appStore.locale === 'zh-CN'
                ? '模块化可拼装 AI Agent 框架'
                : 'Modular composable AI Agent framework' }}
            </div>
          </div>
        </div>

        <a-divider />

        <div class="danger-zone">
          <h3>{{ t('settings.dangerZone') }}</h3>
          <div class="danger-item">
            <div>
              <div class="danger-title">{{ t('settings.clearAllData') }}</div>
              <div class="danger-desc">{{ t('settings.clearDataWarning') }}</div>
            </div>
            <a-button status="danger" type="outline" @click="confirmClearData">
              {{ t('settings.clearAllData') }}
            </a-button>
          </div>
          <div class="danger-item">
            <div>
              <div class="danger-title">{{ t('auth.logout') }}</div>
              <div class="danger-desc">退出当前账号</div>
            </div>
            <a-button status="warning" type="outline" @click="handleLogout">
              {{ t('auth.logout') }}
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add / Edit Model Modal -->
    <a-modal
      v-model:visible="modalVisible"
      :title="editingModel ? t('settings.editModel') : t('settings.addModel')"
      :width="520"
      :ok-loading="modelSaving"
      @ok="submitModelForm"
      @cancel="closeModal"
    >
      <a-form :model="modelForm" layout="vertical">
        <a-form-item label="实例 ID" required>
          <a-input
            v-model="modelForm.id"
            placeholder="如：claude、my-gpt（字母/数字/连字符）"
            :disabled="!!editingModel"
          />
          <div class="form-hint" v-if="!editingModel">
            唯一标识该模型实例，Worker 通过此 ID 引用模型，创建后不可修改
          </div>
        </a-form-item>

        <a-form-item :label="t('settings.modelId')" required>
          <a-input
            v-model="modelForm.modelId"
            :placeholder="t('settings.modelIdPlaceholder')"
            @input="onModelIdInput(modelForm.modelId)"
          />
        </a-form-item>

        <a-form-item :label="t('settings.protocol')" required>
          <a-select v-model="modelForm.protocol">
            <a-option value="anthropic">{{ t('settings.protocolAnthropic') }}</a-option>
            <a-option value="openai">{{ t('settings.protocolOpenAI') }}</a-option>
            <a-option value="openai-compatible">{{ t('settings.protocolOpenAICompat') }}</a-option>
          </a-select>
        </a-form-item>

        <a-form-item :label="t('settings.apiKey')" :required="!editingModel">
          <a-input-password
            v-model="modelForm.apiKey"
            :placeholder="editingModel ? '留空则保持原 Key 不变' : t('settings.apiKeyPlaceholder')"
            allow-clear
          />
          <div class="form-hint" v-if="editingModel">
            留空则保持原 Key 不变
          </div>
        </a-form-item>

        <a-form-item
          :label="t('settings.baseUrl')"
          v-if="modelForm.protocol === 'openai-compatible'"
        >
          <a-input
            v-model="modelForm.baseUrl"
            :placeholder="t('settings.baseUrlPlaceholder')"
            allow-clear
          />
          <div class="form-hint">{{ t('settings.baseUrlHint') }}</div>
        </a-form-item>

        <a-form-item v-if="modelForm.protocol === 'openai-compatible'">
          <a-checkbox v-model="modelForm.insecure">
            {{ t('settings.insecureSSL') }}
          </a-checkbox>
          <div class="form-hint" style="margin-top: 4px;">{{ t('settings.insecureSSLHint') }}</div>
        </a-form-item>

        <a-form-item v-if="modelForm.protocol === 'openai-compatible'">
          <a-checkbox v-model="modelForm.noProxyEnabled">
            {{ t('settings.noProxy') }}
          </a-checkbox>
          <div class="form-hint" style="margin-top: 4px;">{{ t('settings.noProxyHint') }}</div>
        </a-form-item>

        <a-form-item
          v-if="modelForm.protocol === 'openai-compatible' && modelForm.noProxyEnabled"
          :label="t('settings.noProxyAddress')"
        >
          <a-input
            v-model="modelForm.noProxyAddress"
            :placeholder="t('settings.noProxyPlaceholder')"
            allow-clear
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 精细化清除数据对话框 -->
    <a-modal
      v-model:visible="showClearModal"
      title="选择要清除的数据"
      :ok-loading="clearLoading"
      ok-status="danger"
      ok-text="确认清除"
      @ok="executeClearData"
    >
      <p style="margin-bottom: 16px; color: var(--text-secondary); font-size: 13px;">
        请选择需要清除的数据类型。此操作不可恢复，请谨慎操作。
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <a-checkbox v-model="clearOptions.chatHistory">
          <div>
            <div style="font-weight: 500;">聊天记录</div>
            <div style="font-size: 12px; color: var(--text-secondary);">与 AI 员工的对话会话及消息记录</div>
          </div>
        </a-checkbox>
        <a-checkbox v-model="clearOptions.workerChats">
          <div>
            <div style="font-weight: 500;">员工间对话</div>
            <div style="font-size: 12px; color: var(--text-secondary);">AI 员工之间的异步消息、群聊及私信记录</div>
          </div>
        </a-checkbox>
        <a-checkbox v-model="clearOptions.workerConfig">
          <div>
            <div style="font-weight: 500;">员工配置</div>
            <div style="font-size: 12px; color: var(--text-secondary);">所有 AI 员工（Worker）的配置信息</div>
          </div>
        </a-checkbox>
        <a-checkbox v-model="clearOptions.modelConfig">
          <div>
            <div style="font-weight: 500;">模型配置</div>
            <div style="font-size: 12px; color: var(--text-secondary);">所有 AI 模型实例（API Key、端点等）</div>
          </div>
        </a-checkbox>
        <a-checkbox v-model="clearOptions.localStorage">
          <div>
            <div style="font-weight: 500;">本地缓存</div>
            <div style="font-size: 12px; color: var(--text-secondary);">浏览器本地存储（登录状态、UI 偏好等），清除后需重新登录</div>
          </div>
        </a-checkbox>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useModelsStore, type ConfiguredModel, type ModelProtocol } from '@/stores/models';
import { useWorkersStore } from '@/stores/workers';
import { Message, Modal } from '@arco-design/web-vue';
import { modelsApi, workersApi, chatsApi, adminApi, configApi } from '@/api/client';

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();
const modelsStore = useModelsStore();
const workersStore = useWorkersStore();

const activeSection = ref('profile');

const sections = computed(() => [
  { id: 'profile',    icon: '👤', label: t('settings.profile') },
  { id: 'modelmgmt',  icon: '🤖', label: t('settings.modelMgmt') },
  { id: 'appearance', icon: '🎨', label: t('settings.appearance') },
  { id: 'storage',    icon: '💾', label: t('settings.storageConfig') },
  { id: 'about',      icon: 'ℹ️',  label: t('settings.about') },
]);

// ─── Profile ────────────────────────────────────────────────────────────────

const profileForm = reactive({
  name: authStore.user?.name || '',
  email: authStore.user?.email || '',
});

function saveProfile() {
  Message.success(t('settings.saveSuccess'));
}

// ─── Appearance ─────────────────────────────────────────────────────────────

const themes = [
  { value: 'light', label: t('settings.themeLight') },
  { value: 'dark',  label: t('settings.themeDark') },
];

// ─── Model Management ────────────────────────────────────────────────────────

const modalVisible = ref(false);
const editingModel = ref<ConfiguredModel | null>(null);
const modelSaving = ref(false);
const modelDeleting = ref('');

const modelForm = reactive({
  id: '',           // 实例 ID（config 中的 id 字段）
  modelId: '',      // 实际模型名称（config 中的 model 字段）
  protocol: 'anthropic' as ModelProtocol,
  apiKey: '',
  baseUrl: '',
  insecure: false,
  noProxyEnabled: false,
  noProxyAddress: '',
});

function slugifyModelId(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function protocolLabel(protocol: ModelProtocol): string {
  const map: Record<ModelProtocol, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    'openai-compatible': 'OpenAI Compat',
  };
  return map[protocol];
}

function protocolColor(protocol: ModelProtocol): string {
  const map: Record<ModelProtocol, string> = {
    anthropic: 'orangered',
    openai: 'green',
    'openai-compatible': 'purple',
  };
  return map[protocol];
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••••••';
  return key.slice(0, 6) + '••••••••' + key.slice(-4);
}

function openAddModal() {
  editingModel.value = null;
  modelForm.id = '';
  modelForm.modelId = '';
  modelForm.protocol = 'anthropic';
  modelForm.apiKey = '';
  modelForm.baseUrl = '';
  modelForm.insecure = false;
  modelForm.noProxyEnabled = false;
  modelForm.noProxyAddress = '';
  modalVisible.value = true;
}

function openEditModal(model: ConfiguredModel) {
  editingModel.value = model;
  modelForm.id = model.id;
  modelForm.modelId = model.modelId;
  modelForm.protocol = model.protocol;
  modelForm.apiKey = '';
  modelForm.baseUrl = model.baseUrl ?? '';
  modelForm.insecure = model.insecure ?? false;
  modelForm.noProxyEnabled = !!model.noProxy;
  modelForm.noProxyAddress = (model.noProxy && model.noProxy !== '*') ? model.noProxy : '';
  modalVisible.value = true;
}

function closeModal() {
  modalVisible.value = false;
  editingModel.value = null;
}

function onModelIdInput(val: string) {
  if (!editingModel.value && !modelForm.id) {
    modelForm.id = slugifyModelId(val);
  }
}

async function submitModelForm() {
  if (!modelForm.id.trim()) {
    Message.warning(appStore.locale === 'zh-CN' ? '请填写实例 ID' : 'Please fill in the instance ID');
    return;
  }
  if (!modelForm.modelId.trim()) {
    Message.warning(appStore.locale === 'zh-CN' ? '请填写模型名称' : 'Please fill in the model name');
    return;
  }
  if (!editingModel.value && !modelForm.apiKey.trim()) {
    Message.warning(appStore.locale === 'zh-CN' ? '请填写 API Key' : 'Please enter the API key');
    return;
  }

  modelSaving.value = true;
  try {
    const isCompat = modelForm.protocol === 'openai-compatible';
    // 禁用时传空字符串，让服务端明确清除字段（undefined 会被 store 忽略导致旧值保留）
    // 启用但未填写地址时，用 '*' 占位，确保 noProxy 字段被保存（后端只检查是否为非空字符串）
    const noProxyVal = isCompat
      ? (modelForm.noProxyEnabled ? (modelForm.noProxyAddress.trim() || '*') : '')
      : '';
    if (editingModel.value) {
      await modelsStore.updateModel(editingModel.value.id, {
        modelId:  modelForm.modelId.trim(),
        protocol: modelForm.protocol,
        apiKey:   modelForm.apiKey.trim() || undefined,
        baseUrl:  isCompat ? (modelForm.baseUrl.trim() || undefined) : undefined,
        insecure: isCompat ? modelForm.insecure : false,
        noProxy:  noProxyVal,
      });
    } else {
      await modelsStore.addModel({
        id:       modelForm.id.trim(),
        modelId:  modelForm.modelId.trim(),
        protocol: modelForm.protocol,
        apiKey:   modelForm.apiKey.trim(),
        baseUrl:  isCompat ? (modelForm.baseUrl.trim() || undefined) : undefined,
        insecure: isCompat ? modelForm.insecure : false,
        noProxy:  noProxyVal,
      });
    }
    Message.success(t('settings.saveSuccess'));
    closeModal();
  } catch (err) {
    Message.error(err instanceof Error ? err.message : (appStore.locale === 'zh-CN' ? '操作失败' : 'Operation failed'));
  } finally {
    modelSaving.value = false;
  }
}

function confirmDeleteModel(id: string) {
  Modal.confirm({
    title: t('settings.deleteModel'),
    content: t('settings.confirmDeleteModel'),
    async onOk() {
      modelDeleting.value = id;
      try {
        await modelsStore.deleteModel(id);
        Message.success(t('common.success'));
      } catch (err) {
        Message.error(err instanceof Error ? err.message : (appStore.locale === 'zh-CN' ? '删除失败' : 'Delete failed'));
      } finally {
        modelDeleting.value = '';
      }
    },
  });
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const chatRefreshInterval = ref(
  parseInt(localStorage.getItem('bcc_chat_refresh_interval') ?? '30000', 10) / 1000
);

function saveChatRefreshInterval() {
  const ms = (chatRefreshInterval.value || 0) * 1000;
  localStorage.setItem('bcc_chat_refresh_interval', String(ms));
  Message.success(t('settings.saveSuccess'));
}

const storageForm = reactive({
  memoryType: 'file' as 'file' | 'database',
  dataDir: '~/.bcc/',
  dbUrl: '',
  episodicEnabled: true,
  maxEpisodes: 50,
  sessionDir: '~/.bcc/sessions/',
  workspaceBaseDir: '',
  sharedDir: '',
});

async function saveStorage() {
  try {
    const res = await configApi.updateDefaults({
      workspaceBaseDir: storageForm.workspaceBaseDir.trim() || undefined,
      sharedDir:        storageForm.sharedDir.trim() || undefined,
      sessionDir:       storageForm.sessionDir.trim() || undefined,
      enableMemory:     storageForm.episodicEnabled,
    });
    const requiresRestart = (res as { defaults: unknown; requiresRestart?: boolean }).requiresRestart;
    if (requiresRestart) {
      Message.warning(t('settings.saveSuccessRestartRequired'));
    } else {
      Message.success(t('settings.saveSuccess'));
    }
  } catch {
    Message.error(t('common.error'));
  }
}

onMounted(async () => {
  try {
    const res = await configApi.getDefaults();
    const d = res.defaults;
    if (d.workspaceBaseDir) storageForm.workspaceBaseDir = d.workspaceBaseDir;
    if (d.sharedDir)        storageForm.sharedDir        = d.sharedDir;
    if (d.sessionDir)       storageForm.sessionDir       = d.sessionDir;
    storageForm.episodicEnabled = d.enableMemory ?? true;
  } catch { /* 忽略，保留默认值 */ }
});

// ─── About ────────────────────────────────────────────────────────────────────

// ─── 精细化清除数据 ───────────────────────────────────────────────────────────

const showClearModal = ref(false);
const clearOptions = reactive({
  chatHistory: true,    // 聊天记录（用户↔Worker 会话）
  workerChats: true,    // 员工间对话（Worker↔Worker 异步消息）
  modelConfig: false,   // 模型配置
  workerConfig: false,  // 员工配置
  localStorage: false,  // 本地缓存（浏览器存储）
});
const clearLoading = ref(false);

async function executeClearData() {
  clearLoading.value = true;
  const errors: string[] = [];

  try {
    if (clearOptions.chatHistory) {
      await adminApi.deleteAllSessions().catch(e => errors.push('会话: ' + e.message));
    }

    if (clearOptions.workerChats) {
      await chatsApi.deleteAll().catch(e => errors.push('员工间对话: ' + e.message));
    }

    if (clearOptions.workerConfig) {
      const workers = [...workersStore.workers];
      for (const w of workers) {
        await workersApi.delete(w.id).catch(() => {});
      }
      await workersStore.fetchWorkers();
    }

    if (clearOptions.modelConfig) {
      const models = [...modelsStore.models];
      for (const m of models) {
        await modelsApi.delete(m.id).catch(() => {});
      }
      await modelsStore.fetchModels();
    }

    if (clearOptions.localStorage) {
      localStorage.clear();
    }

    showClearModal.value = false;

    if (errors.length > 0) {
      Message.warning('部分数据清除失败：' + errors.join('；'));
    } else {
      Message.success('数据已清除');
    }

    if (clearOptions.localStorage || clearOptions.workerConfig || clearOptions.modelConfig) {
      router.push('/login');
    } else {
      router.push('/chat');
    }
  } finally {
    clearLoading.value = false;
  }
}

function confirmClearData() {
  // 重置默认选项
  clearOptions.chatHistory = true;
  clearOptions.workerChats = true;
  clearOptions.modelConfig = false;
  clearOptions.workerConfig = false;
  clearOptions.localStorage = false;
  showClearModal.value = true;
}

function handleLogout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.settings-view {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* ─── Sub Panel ──────────────────────────────────────────────────────── */

.sub-panel {
  width: var(--subpanel-width);
  min-width: var(--subpanel-width);
  height: 100%;
  background: var(--bg-subpanel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sub-header {
  display: flex;
  align-items: center;
  padding: 16px 16px 12px;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
}

.sn-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.sn-item:hover { background: rgba(22, 93, 255, 0.05); color: var(--text-primary); }
.sn-item.active { background: rgba(22, 93, 255, 0.1); color: #165dff; font-weight: 500; }

.sn-icon { font-size: 18px; }

/* ─── Settings Main ──────────────────────────────────────────────────── */

.settings-main {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
  background: var(--bg-card);
}

.settings-section h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.section-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-header-row h2 {
  margin-bottom: 4px;
}

/* Profile */
.profile-avatar-section {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(22, 93, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
}

/* ─── Model Management ───────────────────────────────────────────────── */

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
}

.model-card {
  background: var(--bg-base);
  border: 1.5px solid var(--border-color);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.15s;
}

.model-card.is-default {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.03);
}

.mc-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mc-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.mc-meta {
  margin-top: 2px;
}

.mc-model-id {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: 'Monaco', 'Menlo', monospace;
}

.mc-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mc-protocol-tag {
  font-size: 11px;
}

.mc-base-url {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: monospace;
}

.mc-key-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.mc-key-label {
  color: var(--text-secondary);
}

.mc-key-val.configured {
  color: var(--text-primary);
  font-family: monospace;
  letter-spacing: 0.5px;
}

.mc-key-val.unconfigured {
  color: #f53f3f;
}

.mc-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.no-models {
  text-align: center;
  padding: 48px 0;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

/* Appearance */
.appearance-group {
  margin-bottom: 24px;
}

.ag-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.theme-options {
  display: flex;
  gap: 16px;
}

.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.theme-preview {
  width: 120px;
  height: 80px;
  border-radius: 12px;
  border: 2px solid var(--border-color);
  overflow: hidden;
  display: flex;
  transition: all 0.2s;
}

.theme-option.active .theme-preview {
  border-color: #165dff;
  box-shadow: 0 0 0 3px rgba(22, 93, 255, 0.2);
}

.theme-preview.light { background: #f2f3f5; }
.theme-preview.dark { background: #17171a; }

.tp-sidebar {
  width: 24px;
  height: 100%;
}
.light .tp-sidebar { background: #1d2129; }
.dark .tp-sidebar { background: #0d0d0f; }

.tp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tp-header {
  height: 14px;
  margin: 6px;
  border-radius: 3px;
}
.light .tp-header { background: #fff; }
.dark .tp-header { background: #232324; }

.tp-content {
  flex: 1;
  margin: 0 6px 6px;
  border-radius: 3px;
}
.light .tp-content { background: #fff; }
.dark .tp-content { background: #232324; }

.theme-name {
  font-size: 13px;
  color: var(--text-secondary);
}

.lang-options {
  display: flex;
  gap: 12px;
}

.lang-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  border: 2px solid var(--border-color);
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.lang-option:hover { border-color: #165dff; color: var(--text-primary); }
.lang-option.active { border-color: #165dff; color: #165dff; background: rgba(22, 93, 255, 0.06); }

.lo-flag { font-size: 20px; }

/* About */
.about-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
  background: var(--bg-base);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  max-width: 480px;
  margin-bottom: 20px;
}

.about-logo {
  font-size: 40px;
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(135deg, #165dff, #722ed1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.about-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.about-ver {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.about-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}

/* Danger zone */
.danger-zone h3 {
  font-size: 15px;
  font-weight: 600;
  color: #f53f3f;
  margin-bottom: 14px;
}

.danger-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: rgba(245, 63, 63, 0.04);
  border: 1px solid rgba(245, 63, 63, 0.15);
  border-radius: 12px;
  margin-bottom: 12px;
  max-width: 560px;
}

.danger-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.danger-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ─── Form helpers ───────────────────────────────────────────────────── */

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  line-height: 1.5;
}

.radio-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}

.ro-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.ro-desc {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
