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

      <!-- API Keys -->
      <div v-if="activeSection === 'apikeys'" class="settings-section">
        <h2>{{ t('settings.apiKeys') }}</h2>
        <p class="section-desc">{{ t('settings.keyMasked') }}</p>

        <div class="api-key-list">
          <div class="api-key-item" v-for="key in apiKeys" :key="key.id">
            <div class="aki-header">
              <span class="aki-provider">{{ key.icon }} {{ key.name }}</span>
              <a-tag :color="key.configured ? 'green' : 'gray'" size="small">
                {{ key.configured ? t('common.enable') : '未配置' }}
              </a-tag>
            </div>
            <div class="aki-input">
              <a-input-password
                v-model="key.value"
                :placeholder="key.configured ? '••••••••••••••••' : t('settings.keyPlaceholder')"
                allow-clear
              />
            </div>
            <a-button
              type="primary"
              size="small"
              @click="saveApiKey(key)"
            >{{ t('common.save') }}</a-button>
          </div>
        </div>

        <a-alert
          type="info"
          style="margin-top: 20px; max-width: 560px;"
        >
          <template #message>
            <span v-if="appStore.locale === 'zh-CN'">
              API Key 保存在本地，不会上传至服务器。请勿分享给他人。
            </span>
            <span v-else>
              API Keys are stored locally and never sent to any server. Do not share them.
            </span>
          </template>
        </a-alert>
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

      <!-- Model Config -->
      <div v-if="activeSection === 'models'" class="settings-section">
        <h2>{{ t('settings.modelConfig') }}</h2>
        <p class="section-desc">{{ t('settings.modelConfigDesc') }}</p>
        <a-form layout="vertical" style="max-width: 560px;">
          <a-form-item :label="t('settings.defaultModel')">
            <a-select v-model="modelForm.defaultModel">
              <a-option
                v-for="m in workersStore.AVAILABLE_MODELS"
                :key="m.id"
                :value="m.id"
              >{{ m.label }}</a-option>
            </a-select>
          </a-form-item>

          <a-form-item :label="t('settings.temperature')">
            <div class="slider-row">
              <a-slider
                v-model="modelForm.temperature"
                :min="0" :max="2" :step="0.1"
                style="flex: 1"
              />
              <span class="slider-val">{{ modelForm.temperature }}</span>
            </div>
            <div class="form-hint">{{ t('settings.temperatureHint') }}</div>
          </a-form-item>

          <a-form-item :label="t('settings.maxTokens')">
            <a-input-number
              v-model="modelForm.maxTokens"
              :min="256" :max="200000" :step="256"
              style="width: 200px"
            />
            <div class="form-hint">{{ t('settings.maxTokensHint') }}</div>
          </a-form-item>

          <a-form-item :label="t('settings.systemPrompt')">
            <a-textarea
              v-model="modelForm.systemPrompt"
              :placeholder="t('settings.systemPromptPlaceholder')"
              :auto-size="{ minRows: 3, maxRows: 6 }"
            />
            <div class="form-hint">{{ t('settings.systemPromptHint') }}</div>
          </a-form-item>

          <a-button type="primary" @click="saveModels">{{ t('common.save') }}</a-button>
        </a-form>
      </div>

      <!-- Storage Config -->
      <div v-if="activeSection === 'storage'" class="settings-section">
        <h2>{{ t('settings.storageConfig') }}</h2>
        <p class="section-desc">{{ t('settings.storageConfigDesc') }}</p>

        <a-form layout="vertical" style="max-width: 560px;">
          <!-- Memory store -->
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

          <!-- Episode config -->
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

          <a-button type="primary" @click="saveStorage">{{ t('common.save') }}</a-button>
        </a-form>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useWorkersStore } from '@/stores/workers';
import { Message, Modal } from '@arco-design/web-vue';

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();
const workersStore = useWorkersStore();

const activeSection = ref('profile');

const sections = computed(() => [
  { id: 'profile',    icon: '👤', label: t('settings.profile') },
  { id: 'apikeys',    icon: '🔑', label: t('settings.apiKeys') },
  { id: 'appearance', icon: '🎨', label: t('settings.appearance') },
  { id: 'models',     icon: '🤖', label: t('settings.modelConfig') },
  { id: 'storage',    icon: '💾', label: t('settings.storageConfig') },
  { id: 'about',      icon: 'ℹ️',  label: t('settings.about') },
]);

const profileForm = reactive({
  name: authStore.user?.name || '',
  email: authStore.user?.email || '',
});

const apiKeys = reactive([
  { id: 'anthropic', name: 'Anthropic', icon: '🟠', configured: true, value: '' },
  { id: 'openai',    name: 'OpenAI',    icon: '🟢', configured: false, value: '' },
]);

const themes = [
  { value: 'light', label: t('settings.themeLight') },
  { value: 'dark',  label: t('settings.themeDark') },
];

const modelForm = reactive({
  defaultModel: 'claude-sonnet-4-6',
  temperature: 0.7,
  maxTokens: 8192,
  systemPrompt: '',
});

const storageForm = reactive({
  memoryType: 'file' as 'file' | 'database',
  dataDir: '~/.bcc/',
  dbUrl: '',
  episodicEnabled: true,
  maxEpisodes: 50,
  sessionDir: '~/.bcc/sessions/',
});

function saveProfile() {
  Message.success(t('settings.saveSuccess'));
}

function saveApiKey(key: typeof apiKeys[0]) {
  if (key.value) {
    key.configured = true;
    key.value = '';
  }
  Message.success(t('settings.saveSuccess'));
}

function saveModels() {
  Message.success(t('settings.saveSuccess'));
}

function saveStorage() {
  Message.success(t('settings.saveSuccess'));
}

function confirmClearData() {
  Modal.confirm({
    title: t('settings.clearAllData'),
    content: t('settings.clearDataWarning'),

    onOk() {
      localStorage.clear();
      Message.success(t('common.success'));
      router.push('/login');
    },
  });
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
  margin-bottom: 20px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 20px;
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

/* API Keys */
.api-key-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
}

.api-key-item {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 18px 20px;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.aki-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.aki-provider {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
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

/* ─── Model / Storage form helpers ──────────────────────────────────── */

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slider-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 32px;
  text-align: right;
}

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
