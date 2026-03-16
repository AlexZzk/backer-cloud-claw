<template>
  <div class="skills-view">
    <!-- ── Left: list panel ── -->
    <div class="list-panel">
      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'local' }"
          @click="activeTab = 'local'; selectedName = null"
        >📦 {{ t('skills.tabLocal') }}</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'hub' }"
          @click="activeTab = 'hub'; selectedName = null"
        >🌐 Hub</button>
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

      <!-- Local skill list -->
      <div v-if="activeTab === 'local'" class="skill-list">
        <div v-if="store.loading" class="list-loading"><a-spin size="small" /></div>
        <div v-else-if="filteredSkills.length === 0" class="list-empty">{{ t('common.noData') }}</div>

        <template v-else>
          <!-- Group headers + items -->
          <template v-for="group in skillGroups" :key="group.source">
            <div class="group-header">{{ groupLabel(group.source) }} · {{ group.items.length }}</div>
            <div
              v-for="skill in group.items"
              :key="skill.name"
              class="skill-item"
              :class="{ active: selectedName === skill.name }"
              @click="selectSkill(skill)"
            >
              <div class="skill-item-name">{{ skill.name }}</div>
              <div class="skill-item-desc">{{ skill.description }}</div>
            </div>
          </template>
        </template>
      </div>

      <!-- Hub search list -->
      <div v-else class="skill-list">
        <div class="hub-search-row">
          <a-input-search
            v-model="hubQuery"
            :placeholder="t('skills.hubSearchPlaceholder')"
            :loading="store.hubLoading"
            search-button
            size="small"
            @search="doHubSearch"
          />
        </div>
        <div v-if="store.hubLoading" class="list-loading"><a-spin size="small" /></div>
        <div v-else-if="hubSearched && store.hubResults.length === 0" class="list-empty">{{ t('skills.hubNoResults') }}</div>
        <div v-else-if="!hubSearched" class="list-empty-hint">{{ t('skills.hubHint') }}</div>
        <div
          v-else
          v-for="skill in store.hubResults"
          :key="skill.name"
          class="skill-item"
          :class="{ active: selectedHubSkill?.name === skill.name }"
          @click="selectedHubSkill = skill; selectedName = skill.name"
        >
          <div class="skill-item-name">
            {{ skill.name }}
            <span v-if="skill.downloads !== undefined" class="hub-dl">⬇ {{ skill.downloads }}</span>
          </div>
          <div class="skill-item-desc">{{ skill.description }}</div>
        </div>
      </div>

      <!-- Footer: stats + new button -->
      <div class="list-footer">
        <div class="footer-stats" v-if="activeTab === 'local' && store.stats">
          <span>内置 {{ store.stats.builtin }}</span>
          <span>用户 {{ store.stats.user }}</span>
          <span v-if="store.stats.project">项目 {{ store.stats.project }}</span>
        </div>
        <a-button
          v-if="activeTab === 'local'"
          type="primary"
          size="small"
          style="width:100%"
          @click="openNew"
        >+ {{ t('skills.create') }}</a-button>
      </div>
    </div>

    <!-- ── Right: detail panel ── -->
    <div class="detail-panel">

      <!-- Empty state -->
      <div v-if="!selectedName" class="detail-empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-text">{{ t('skills.selectHint') }}</div>
      </div>

      <!-- Local skill detail / edit -->
      <template v-else-if="activeTab === 'local' && currentSkill">
        <div class="detail-header">
          <div class="detail-title-row">
            <span class="detail-name">{{ currentSkill.name }}</span>
            <span class="source-badge" :class="currentSkill.source">{{ groupLabel(currentSkill.source ?? 'builtin') }}</span>
          </div>
          <div class="detail-actions" v-if="currentSkill.source !== 'builtin'">
            <a-button v-if="!editing" size="small" @click="startEdit">✏️ {{ t('common.edit') }}</a-button>
            <template v-else>
              <a-button size="small" type="primary" :loading="saving" @click="saveEdit">{{ t('common.save') }}</a-button>
              <a-button size="small" @click="cancelEdit">{{ t('common.cancel') }}</a-button>
            </template>
            <a-button size="small" status="danger" @click="confirmDelete(currentSkill.name)">{{ t('common.delete') }}</a-button>
          </div>
        </div>

        <!-- View mode -->
        <div v-if="!editing" class="detail-body">
          <section class="detail-section">
            <div class="section-label">{{ t('common.description') }}</div>
            <div class="section-content desc-text">{{ currentSkill.description || '—' }}</div>
          </section>

          <section v-if="currentSkill.system" class="detail-section">
            <div class="section-label">System Prompt</div>
            <div class="section-content">
              <pre class="code-block system-block">{{ currentSkill.system }}</pre>
            </div>
          </section>

          <section class="detail-section">
            <div class="section-label">{{ t('skills.promptLabel') }}</div>
            <div class="section-content">
              <pre v-if="currentSkill.prompt" class="code-block">{{ currentSkill.prompt }}</pre>
              <span v-else class="muted">（空）</span>
            </div>
          </section>

          <!-- MD source hint -->
          <div class="md-hint">
            <span class="hint-icon">📄</span>
            <span v-if="currentSkill.source !== 'builtin'">
              存储于 <code>~/.bcc/skills/{{ currentSkill.name }}.md</code>，可直接用文本编辑器修改
            </span>
            <span v-else>内置技能（只读），创建同名用户技能可覆盖</span>
          </div>
        </div>

        <!-- Edit mode -->
        <div v-else class="detail-body">
          <a-form layout="vertical">
            <a-form-item :label="t('common.description')">
              <a-input v-model="editForm.description" :placeholder="t('skills.descPlaceholder')" />
            </a-form-item>
            <a-form-item label="Prompt">
              <a-textarea
                v-model="editForm.prompt"
                :auto-size="{ minRows: 4, maxRows: 12 }"
                :placeholder="t('skills.promptPlaceholder')"
                class="code-textarea"
              />
            </a-form-item>
            <a-form-item>
              <template #label>
                <span>System Prompt</span>
                <span class="optional-label">（{{ t('common.more') }}...可选）</span>
              </template>
              <a-textarea
                v-model="editForm.system"
                :auto-size="{ minRows: 3, maxRows: 10 }"
                :placeholder="t('skills.systemPlaceholder')"
                class="code-textarea"
              />
            </a-form-item>
          </a-form>
        </div>
      </template>

      <!-- Hub skill detail -->
      <template v-else-if="activeTab === 'hub' && selectedHubSkill">
        <div class="detail-header">
          <div class="detail-title-row">
            <span class="detail-name">{{ selectedHubSkill.name }}</span>
            <span v-if="selectedHubSkill.author" class="hub-author">by {{ selectedHubSkill.author }}</span>
          </div>
          <div class="detail-actions">
            <a-button
              type="primary"
              size="small"
              :loading="installing === selectedHubSkill.name"
              @click="installHubSkill(selectedHubSkill)"
            >⬇ {{ t('skills.install') }}</a-button>
          </div>
        </div>
        <div class="detail-body">
          <section class="detail-section">
            <div class="section-label">{{ t('common.description') }}</div>
            <div class="section-content desc-text">{{ selectedHubSkill.description }}</div>
          </section>
          <section v-if="selectedHubSkill.system" class="detail-section">
            <div class="section-label">System Prompt</div>
            <pre class="code-block system-block">{{ selectedHubSkill.system }}</pre>
          </section>
          <section class="detail-section">
            <div class="section-label">Prompt</div>
            <pre v-if="selectedHubSkill.prompt" class="code-block">{{ selectedHubSkill.prompt }}</pre>
            <span v-else class="muted">（空）</span>
          </section>
          <div class="hub-meta" v-if="selectedHubSkill.tags?.length">
            <a-tag v-for="tag in selectedHubSkill.tags" :key="tag" size="small">{{ tag }}</a-tag>
          </div>
        </div>
      </template>

    </div>

    <!-- ── New skill modal ── -->
    <a-modal
      v-model:visible="showNewModal"
      :title="t('skills.createTitle')"
      :ok-loading="saving"
      @ok="submitNew"
      @cancel="showNewModal = false"
    >
      <a-form :model="newForm" layout="vertical">
        <a-form-item :label="t('common.name')" required>
          <a-input v-model="newForm.name" :placeholder="t('skills.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('common.description')" required>
          <a-input v-model="newForm.description" :placeholder="t('skills.descPlaceholder')" />
        </a-form-item>
        <a-form-item label="Prompt" required>
          <a-textarea
            v-model="newForm.prompt"
            :auto-size="{ minRows: 3, maxRows: 8 }"
            :placeholder="t('skills.promptPlaceholder')"
            class="code-textarea"
          />
        </a-form-item>
        <a-form-item label="System Prompt（可选）">
          <a-textarea
            v-model="newForm.system"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            :placeholder="t('skills.systemPlaceholder')"
            class="code-textarea"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Message, Modal } from '@arco-design/web-vue';
import { useSkillsStore } from '@/stores/skills';
import type { ApiSkill, ApiHubSkill } from '@/api/client';
import { skillsApi } from '@/api/client';

const { t } = useI18n();
const store = useSkillsStore();

// ── State ──────────────────────────────────────────────────────────────────
const activeTab    = ref<'local' | 'hub'>('local');
const listFilter   = ref('');
const selectedName = ref<string | null>(null);
const editing      = ref(false);
const saving       = ref(false);
const showNewModal = ref(false);
const hubQuery     = ref('');
const hubSearched  = ref(false);
const installing   = ref<string | null>(null);
const selectedHubSkill = ref<ApiHubSkill | null>(null);

const editForm = ref({ description: '', prompt: '', system: '' });
const newForm  = ref({ name: '', description: '', prompt: '', system: '' });

// ── Computed ───────────────────────────────────────────────────────────────
const filteredSkills = computed(() => {
  const q = listFilter.value.trim().toLowerCase();
  if (!q) return store.skills;
  return store.skills.filter(s =>
    s.name.includes(q) || s.description.toLowerCase().includes(q)
  );
});

interface SkillGroup { source: string; items: ApiSkill[] }
const skillGroups = computed((): SkillGroup[] => {
  const map = new Map<string, ApiSkill[]>();
  for (const s of filteredSkills.value) {
    const src = s.source ?? 'builtin';
    if (!map.has(src)) map.set(src, []);
    map.get(src)!.push(s);
  }
  const order = ['project', 'user', 'builtin'];
  return order.filter(s => map.has(s)).map(s => ({ source: s, items: map.get(s)! }));
});

const currentSkill = computed(() =>
  selectedName.value ? store.skills.find(s => s.name === selectedName.value) ?? null : null
);

// ── Helpers ────────────────────────────────────────────────────────────────
function groupLabel(source: string) {
  return source === 'builtin' ? '内置' : source === 'user' ? '用户' : '项目';
}

function selectSkill(skill: ApiSkill) {
  selectedName.value = skill.name;
  editing.value = false;
}

function startEdit() {
  if (!currentSkill.value) return;
  editForm.value = {
    description: currentSkill.value.description,
    prompt:      currentSkill.value.prompt,
    system:      currentSkill.value.system ?? '',
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!currentSkill.value) return;
  saving.value = true;
  try {
    await skillsApi.delete(currentSkill.value.name);
    await skillsApi.create({
      name:        currentSkill.value.name,
      description: editForm.value.description,
      prompt:      editForm.value.prompt,
      ...(editForm.value.system.trim() && { system: editForm.value.system }),
    });
    await store.fetchSkills();
    editing.value = false;
    Message.success(t('common.success'));
  } catch (err) {
    Message.error(err instanceof Error ? err.message : t('common.error'));
  } finally {
    saving.value = false;
  }
}

function openNew() {
  newForm.value = { name: '', description: '', prompt: '', system: '' };
  showNewModal.value = true;
}

async function submitNew() {
  const { name, description, prompt, system } = newForm.value;
  if (!name.trim() || !description.trim() || !prompt.trim()) {
    Message.warning(t('skills.formRequired'));
    return;
  }
  saving.value = true;
  try {
    await store.createSkill({
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      ...(system.trim() && { system: system.trim() }),
    });
    showNewModal.value = false;
    selectedName.value = name.trim();
    Message.success(t('skills.createSuccess'));
  } catch (err) {
    Message.error(err instanceof Error ? err.message : t('common.error'));
  } finally {
    saving.value = false;
  }
}

function confirmDelete(name: string) {
  Modal.confirm({
    title: t('skills.deleteConfirmTitle'),
    content: t('skills.deleteConfirmContent', { name }),
    okButtonProps: { status: 'danger' },
    onOk: async () => {
      try {
        await store.deleteSkill(name);
        selectedName.value = null;
        Message.success(t('skills.deleteSuccess'));
      } catch (err) {
        Message.error(err instanceof Error ? err.message : t('common.error'));
      }
    },
  });
}

async function doHubSearch() {
  if (!hubQuery.value.trim()) return;
  hubSearched.value = true;
  selectedHubSkill.value = null;
  selectedName.value = null;
  await store.searchHub(hubQuery.value.trim());
}

async function installHubSkill(skill: ApiHubSkill) {
  installing.value = skill.name;
  try {
    await skillsApi.create({
      name:        skill.name,
      description: skill.description,
      prompt:      skill.prompt,
      ...(skill.system !== undefined && { system: skill.system }),
    });
    await store.fetchSkills();
    Message.success(t('skills.installSuccess', { name: skill.name }));
  } catch (err) {
    Message.error(err instanceof Error ? err.message : t('common.error'));
  } finally {
    installing.value = null;
  }
}

onMounted(() => { store.fetchSkills(); });
</script>

<style scoped>
.skills-view {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-1);
}

/* ── Left panel ─────────────────────────────────────────────── */
.list-panel {
  width: 240px;
  min-width: 200px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-2);
  overflow: hidden;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 0;
  font-size: 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-2);
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}
.tab-btn:hover { color: var(--color-text-1); background: var(--color-fill-1); }
.tab-btn.active { color: rgb(var(--primary-6)); border-bottom-color: rgb(var(--primary-6)); font-weight: 500; }

.list-search {
  padding: 8px;
  flex-shrink: 0;
}

.skill-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 8px;
}

.hub-search-row {
  padding: 0 8px 8px;
}

.list-loading, .list-empty, .list-empty-hint {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text-3);
  font-size: 12px;
}

.group-header {
  padding: 6px 12px 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.skill-item {
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 6px;
  transition: background 0.12s;
}
.skill-item:hover { background: var(--color-fill-2); }
.skill-item.active { background: var(--color-primary-light-1); }

.skill-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  font-family: monospace;
  display: flex;
  align-items: center;
  gap: 4px;
}
.hub-dl { font-size: 10px; color: var(--color-text-3); font-family: sans-serif; font-weight: 400; }

.skill-item-desc {
  font-size: 11px;
  color: var(--color-text-3);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-footer {
  padding: 8px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
.footer-stats {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-3);
  margin-bottom: 8px;
  justify-content: center;
}

/* ── Right panel ──────────────────────────────────────────────── */
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-1);
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
.empty-icon { font-size: 40px; opacity: 0.4; }
.empty-text { font-size: 14px; }

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 28px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.detail-name {
  font-size: 18px;
  font-weight: 700;
  font-family: monospace;
  color: var(--color-text-1);
}
.source-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.source-badge.builtin { background: var(--color-fill-3); color: var(--color-text-3); }
.source-badge.user    { background: var(--color-primary-light-1); color: rgb(var(--primary-6)); }
.source-badge.project { background: var(--color-success-light-1); color: rgb(var(--success-6)); }
.hub-author { font-size: 13px; color: var(--color-text-3); }

.detail-actions { display: flex; gap: 8px; }

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
}

.detail-section {
  margin-bottom: 20px;
}
.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-3);
  margin-bottom: 6px;
}
.section-content { }
.desc-text { font-size: 14px; color: var(--color-text-1); }
.muted { color: var(--color-text-3); font-size: 13px; }

.code-block {
  margin: 0;
  font-size: 13px;
  font-family: monospace;
  color: var(--color-text-1);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-fill-1);
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}
.system-block {
  border-left: 3px solid rgb(var(--warning-6));
  background: var(--color-warning-light-1);
}

.code-textarea :deep(textarea) {
  font-family: monospace;
  font-size: 13px;
}

.md-hint {
  margin-top: 24px;
  padding: 10px 14px;
  background: var(--color-fill-1);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text-3);
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.hint-icon { flex-shrink: 0; }
.md-hint code { font-size: 11px; background: var(--color-fill-3); padding: 1px 4px; border-radius: 3px; }

.hub-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }

.optional-label { font-size: 11px; color: var(--color-text-3); font-weight: 400; margin-left: 4px; }
</style>
