<template>
  <div class="tools-view">
    <!-- ── Left: list panel ── -->
    <div class="list-panel">
      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'builtin' }"
          @click="switchTab('builtin')"
        >⚙️ {{ t('tools.tabBuiltin') }}</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'browser' }"
          @click="switchTab('browser')"
        >🌐 {{ t('tools.tabBrowser') }}</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'user' }"
          @click="switchTab('user')"
        >🔧 {{ t('tools.tabUser') }}</button>
      </div>

      <!-- Search bar -->
      <div class="list-search">
        <a-input
          v-model="listFilter"
          :placeholder="t('common.search') + '…'"
          allow-clear
          size="small"
        >
          <template #prefix><span style="color:var(--color-text-3)">🔍</span></template>
        </a-input>
      </div>

      <!-- Tool list -->
      <div class="tool-list">
        <div v-if="loading" class="list-loading"><a-spin size="small" /></div>
        <div v-else-if="filteredTools.length === 0 && activeTab === 'user'" class="list-empty-hint">
          <div>{{ t('tools.noTools') }}</div>
          <div class="list-empty-sub">{{ t('tools.addFirst') }}</div>
        </div>
        <div v-else-if="filteredTools.length === 0" class="list-empty">{{ t('common.noData') }}</div>

        <div
          v-for="tool in filteredTools"
          :key="tool.id"
          class="tool-item"
          :class="{ active: selectedId === tool.id }"
          @click="selectTool(tool)"
        >
          <div class="tool-item-name">
            <span>{{ tool.name || tool.id }}</span>
            <span class="tool-category-badge" :class="'cat-' + tool.category">
              {{ categoryLabel(tool.category) }}
            </span>
          </div>
          <div class="tool-item-desc">{{ tool.description }}</div>
        </div>
      </div>

      <!-- Footer -->
      <div class="list-footer">
        <div class="footer-stats">
          <span>{{ filteredTools.length }} {{ t('common.all') }}</span>
        </div>
        <a-button
          v-if="activeTab === 'user'"
          type="primary"
          size="small"
          style="width:100%"
          @click="openCreate"
        >+ {{ t('tools.addTool') }}</a-button>
      </div>
    </div>

    <!-- ── Right: detail panel ── -->
    <div class="detail-panel">
      <!-- Placeholder -->
      <div v-if="!selectedTool" class="detail-empty">
        <div class="detail-empty-icon">🔧</div>
        <div class="detail-empty-hint">{{ t('tools.selectHint') }}</div>
      </div>

      <!-- Tool detail -->
      <div v-else class="detail-content">
        <div class="detail-header">
          <div class="detail-title-row">
            <h2 class="detail-title">{{ selectedTool.name || selectedTool.id }}</h2>
            <span class="tool-category-badge lg" :class="'cat-' + selectedTool.category">
              {{ categoryLabel(selectedTool.category) }}
            </span>
          </div>
          <div class="detail-id">ID: <code>{{ selectedTool.id }}</code></div>
          <p class="detail-desc">{{ selectedTool.description }}</p>

          <!-- Capability notice -->
          <div v-if="'requiresCapability' in selectedTool && selectedTool.requiresCapability" class="cap-notice">
            ⚠️ {{ t('tools.requiresCapability') }}<code>{{ selectedTool.requiresCapability }}</code>
          </div>

          <!-- Webhook URL (user tools) -->
          <template v-if="isUserTool(selectedTool)">
            <div class="detail-section-title">Webhook</div>
            <div class="webhook-info">
              <span class="http-method">{{ selectedTool.method || 'POST' }}</span>
              <code class="webhook-url">{{ selectedTool.webhookUrl }}</code>
            </div>
            <div v-if="selectedTool.headers && Object.keys(selectedTool.headers).length > 0" class="headers-info">
              <div class="detail-section-title">{{ t('tools.headersLabel') }}</div>
              <pre class="code-block">{{ JSON.stringify(selectedTool.headers, null, 2) }}</pre>
            </div>
          </template>
        </div>

        <!-- Input parameters -->
        <div class="detail-section">
          <div class="detail-section-title">{{ t('tools.inputParams') }}</div>
          <div v-if="!hasParams(selectedTool)" class="no-params">{{ t('tools.noParams') }}</div>
          <div v-else class="param-list">
            <div
              v-for="(param, name) in getParams(selectedTool)"
              :key="name"
              class="param-item"
            >
              <div class="param-header">
                <code class="param-name">{{ name }}</code>
                <span class="param-type">{{ param.type }}</span>
                <span
                  v-if="isRequired(selectedTool, name)"
                  class="param-required"
                >{{ t('tools.requiredParam') }}</span>
              </div>
              <div v-if="param.description" class="param-desc">{{ param.description }}</div>
              <div v-if="param.enum" class="param-enum">
                {{ param.enum.map(v => `"${v}"`).join(' | ') }}
              </div>
            </div>
          </div>
        </div>

        <!-- User tool actions -->
        <div v-if="isUserTool(selectedTool)" class="detail-actions">
          <a-button type="primary" @click="openEdit(selectedTool)">✏️ {{ t('tools.editTool') }}</a-button>
          <a-popconfirm
            :title="t('tools.deleteConfirmTitle')"
            :content="t('tools.deleteConfirmContent', { name: selectedTool.name })"
            :ok-text="t('common.confirm')"
            :cancel-text="t('common.cancel')"
            @ok="deleteTool(selectedTool.id)"
          >
            <a-button status="danger">🗑 {{ t('common.delete') }}</a-button>
          </a-popconfirm>
        </div>
      </div>
    </div>

    <!-- ── Create / Edit Modal ── -->
    <a-modal
      v-model:visible="modalVisible"
      :title="editingTool ? t('tools.editTitle') : t('tools.createTitle')"
      :ok-text="t('common.save')"
      :cancel-text="t('common.cancel')"
      :ok-loading="saving"
      width="560px"
      @ok="submitForm"
      @cancel="closeModal"
    >
      <a-form :model="form" layout="vertical" size="small">
        <a-form-item :label="t('tools.idLabel')" :extra="editingTool ? '' : t('tools.idHint')">
          <a-input
            v-model="form.id"
            :placeholder="t('tools.idPlaceholder')"
            :disabled="!!editingTool"
          />
        </a-form-item>

        <a-form-item :label="t('common.name')">
          <a-input v-model="form.name" :placeholder="t('common.name')" />
        </a-form-item>

        <a-form-item :label="t('common.description')">
          <a-textarea v-model="form.description" :placeholder="t('common.description')" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </a-form-item>

        <a-form-item :label="t('tools.webhookUrl')">
          <a-input v-model="form.webhookUrl" :placeholder="t('tools.webhookPlaceholder')" />
        </a-form-item>

        <a-form-item :label="t('tools.method')">
          <a-select v-model="form.method">
            <a-option value="POST">POST</a-option>
            <a-option value="GET">GET</a-option>
            <a-option value="PUT">PUT</a-option>
            <a-option value="PATCH">PATCH</a-option>
          </a-select>
        </a-form-item>

        <a-form-item :label="t('tools.headersLabel')">
          <a-textarea
            v-model="form.headersJson"
            :placeholder="t('tools.headersPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            :status="headersError ? 'error' : ''"
          />
          <div v-if="headersError" class="form-error">{{ t('tools.invalidHeaders') }}</div>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Message } from '@arco-design/web-vue';
import { toolsApi, type ApiToolEntry, type UserToolConfig, type ToolCategory } from '@/api/client';

const { t } = useI18n();

// ── State ──────────────────────────────────────────────────────────────

const loading = ref(false);
const saving  = ref(false);

const builtinTools = ref<ApiToolEntry[]>([]);
const browserTools = ref<ApiToolEntry[]>([]);
const userTools    = ref<UserToolConfig[]>([]);

const activeTab  = ref<'builtin' | 'browser' | 'user'>('builtin');
const listFilter = ref('');
const selectedId = ref<string | null>(null);

// ── Computed ───────────────────────────────────────────────────────────

type DisplayUserTool = UserToolConfig & { category: ToolCategory };
type AnyTool = ApiToolEntry | DisplayUserTool;

const currentList = computed<AnyTool[]>(() => {
  if (activeTab.value === 'builtin') return builtinTools.value;
  if (activeTab.value === 'browser') return browserTools.value;
  return userTools.value.map(u => ({
    ...u,
    category: 'user' as ToolCategory,
  }));
});

const filteredTools = computed<AnyTool[]>(() => {
  const q = listFilter.value.trim().toLowerCase();
  if (!q) return currentList.value;
  return currentList.value.filter(t =>
    t.id.toLowerCase().includes(q) ||
    (t.name ?? '').toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q),
  );
});

const selectedTool = computed<AnyTool | null>(() => {
  if (!selectedId.value) return null;
  return filteredTools.value.find(t => t.id === selectedId.value) ?? null;
});

// ── Helpers ────────────────────────────────────────────────────────────

function isUserTool(tool: AnyTool): tool is DisplayUserTool {
  return activeTab.value === 'user' && 'webhookUrl' in tool;
}

function hasParams(tool: AnyTool): boolean {
  const p = tool.inputParams;
  return !!p && Object.keys(p).length > 0;
}

function getParams(tool: AnyTool) {
  return tool.inputParams ?? {};
}

function isRequired(tool: AnyTool, paramName: string): boolean {
  return (tool.requiredParams ?? []).includes(paramName);
}

function categoryLabel(cat: ToolCategory | string): string {
  const map: Record<string, string> = {
    builtin: t('tools.categoryBuiltin'),
    browser: t('tools.categoryBrowser'),
    user:    t('tools.categoryUser'),
  };
  return map[cat] ?? cat;
}

function selectTool(tool: AnyTool) {
  selectedId.value = tool.id;
}

function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab;
  selectedId.value = null;
  listFilter.value = '';
}

// ── Load ───────────────────────────────────────────────────────────────

async function loadTools() {
  loading.value = true;
  try {
    const data = await toolsApi.list();
    builtinTools.value = data.builtin;
    browserTools.value = data.browser;
    userTools.value    = data.user;
  } catch (err) {
    console.error('Failed to load tools', err);
  } finally {
    loading.value = false;
  }
}

onMounted(loadTools);

// ── Modal ──────────────────────────────────────────────────────────────

interface ToolForm {
  id: string;
  name: string;
  description: string;
  webhookUrl: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headersJson: string;
}

const modalVisible = ref(false);
const editingTool  = ref<UserToolConfig | null>(null);
const headersError = ref(false);

const form = ref<ToolForm>({
  id: '', name: '', description: '',
  webhookUrl: '', method: 'POST', headersJson: '',
});

function openCreate() {
  editingTool.value = null;
  form.value = { id: '', name: '', description: '', webhookUrl: '', method: 'POST', headersJson: '' };
  headersError.value = false;
  modalVisible.value = true;
}

function openEdit(tool: UserToolConfig) {
  editingTool.value = tool;
  form.value = {
    id:          tool.id,
    name:        tool.name,
    description: tool.description,
    webhookUrl:  tool.webhookUrl,
    method:      tool.method ?? 'POST',
    headersJson: tool.headers ? JSON.stringify(tool.headers, null, 2) : '',
  };
  headersError.value = false;
  modalVisible.value = true;
}

function closeModal() {
  modalVisible.value = false;
  editingTool.value  = null;
}

async function submitForm() {
  const f = form.value;
  if (!f.id.trim() || !f.name.trim() || !f.description.trim() || !f.webhookUrl.trim()) {
    Message.warning(t('tools.formRequired'));
    return;
  }

  // Parse headers JSON
  let headers: Record<string, string> | undefined;
  if (f.headersJson.trim()) {
    try {
      headers = JSON.parse(f.headersJson) as Record<string, string>;
      headersError.value = false;
    } catch {
      headersError.value = true;
      return;
    }
  }

  const payload: Partial<UserToolConfig> = {
    id:          f.id.trim(),
    name:        f.name.trim(),
    description: f.description.trim(),
    webhookUrl:  f.webhookUrl.trim(),
    method:      f.method,
  };
  if (headers) payload.headers = headers;

  saving.value = true;
  try {
    if (editingTool.value) {
      await toolsApi.update(editingTool.value.id, payload);
      Message.success(t('tools.updateSuccess'));
    } else {
      await toolsApi.create(payload as UserToolConfig);
      Message.success(t('tools.createSuccess'));
    }
    closeModal();
    await loadTools();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Message.error(msg);
  } finally {
    saving.value = false;
  }
}

async function deleteTool(id: string) {
  try {
    await toolsApi.delete(id);
    Message.success(t('tools.deleteSuccess'));
    if (selectedId.value === id) selectedId.value = null;
    await loadTools();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Message.error(msg);
  }
}
</script>

<style scoped>
.tools-view {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--bg-base);
}

/* ── List panel ───────────────────────────────────────────────────────── */

.list-panel {
  width: 280px;
  min-width: 220px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
}

.tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: rgba(22, 93, 255, 0.06);
}

.list-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.tool-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.list-loading,
.list-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-3);
  font-size: 13px;
}

.list-empty-hint {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-3);
  font-size: 13px;
}

.list-empty-sub {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.7;
}

.tool-item {
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.12s;
}

.tool-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.tool-item.active {
  background: rgba(22, 93, 255, 0.08);
  border-left-color: var(--color-primary);
}

.dark .tool-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tool-item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  font-family: monospace;
}

.tool-item-desc {
  font-size: 11px;
  color: var(--color-text-3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-category-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: sans-serif;
  font-weight: 400;
  flex-shrink: 0;
}

.tool-category-badge.lg {
  font-size: 12px;
  padding: 2px 8px;
}

.cat-builtin { background: rgba(0, 180, 42, 0.12); color: #00b42a; }
.cat-browser { background: rgba(22, 93, 255, 0.12); color: #165dff; }
.cat-user    { background: rgba(114, 46, 209, 0.12); color: #722ed1; }

.list-footer {
  padding: 8px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.footer-stats {
  font-size: 11px;
  color: var(--color-text-3);
  display: flex;
  gap: 10px;
}

/* ── Detail panel ─────────────────────────────────────────────────────── */

.detail-panel {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  gap: 12px;
}

.detail-empty-icon {
  font-size: 48px;
  opacity: 0.3;
}

.detail-empty-hint {
  font-size: 14px;
}

.detail-content {
  padding: 24px 28px;
  max-width: 760px;
}

.detail-header {
  margin-bottom: 24px;
}

.detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.detail-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-1);
  margin: 0;
}

.detail-id {
  font-size: 12px;
  color: var(--color-text-3);
  margin-bottom: 8px;
}

.detail-id code {
  background: rgba(0,0,0,0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.dark .detail-id code {
  background: rgba(255,255,255,0.08);
}

.detail-desc {
  font-size: 14px;
  color: var(--color-text-2);
  margin: 0 0 12px;
  line-height: 1.6;
}

.cap-notice {
  padding: 8px 12px;
  background: rgba(255, 190, 0, 0.1);
  border: 1px solid rgba(255, 190, 0, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 12px;
}

.cap-notice code {
  font-family: monospace;
  background: rgba(255, 190, 0, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 4px;
}

.webhook-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.03);
  border-radius: 6px;
  font-size: 13px;
}

.dark .webhook-info {
  background: rgba(255,255,255,0.04);
}

.http-method {
  background: var(--color-primary);
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.webhook-url {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
  color: var(--color-text-2);
}

.headers-info {
  margin-top: 8px;
}

.code-block {
  background: rgba(0,0,0,0.04);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  font-family: monospace;
  color: var(--color-text-2);
  overflow-x: auto;
  margin: 6px 0 0;
}

.dark .code-block {
  background: rgba(255,255,255,0.05);
}

/* ── Section ──────────────────────────────────────────────────────────── */

.detail-section {
  margin-top: 8px;
}

.detail-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  margin-top: 16px;
}

.no-params {
  font-size: 13px;
  color: var(--color-text-3);
  font-style: italic;
}

/* ── Param list ───────────────────────────────────────────────────────── */

.param-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.param-item {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: rgba(0,0,0,0.02);
}

.dark .param-item {
  background: rgba(255,255,255,0.02);
}

.param-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.param-name {
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.param-type {
  font-size: 11px;
  background: rgba(22, 93, 255, 0.1);
  color: #165dff;
  padding: 1px 6px;
  border-radius: 4px;
}

.param-required {
  font-size: 11px;
  background: rgba(245, 63, 63, 0.1);
  color: #f53f3f;
  padding: 1px 6px;
  border-radius: 4px;
}

.param-desc {
  font-size: 12px;
  color: var(--color-text-3);
  line-height: 1.5;
}

.param-enum {
  font-size: 11px;
  color: var(--color-text-3);
  font-family: monospace;
  margin-top: 4px;
}

/* ── Actions ──────────────────────────────────────────────────────────── */

.detail-actions {
  display: flex;
  gap: 10px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

/* ── Form ─────────────────────────────────────────────────────────────── */

.form-error {
  font-size: 12px;
  color: var(--color-danger);
  margin-top: 4px;
}
</style>
