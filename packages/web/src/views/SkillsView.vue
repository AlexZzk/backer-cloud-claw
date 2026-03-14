<template>
  <div class="skills-view">
    <!-- Left panel: tab navigation -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">🧩 {{ t('nav.skills') }}</span>
      </div>
      <div class="skills-nav">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="sn-item"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="sn-icon">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </div>
      </div>
      <div class="skills-stats" v-if="store.stats">
        <div class="stat-item">
          <span class="stat-label">{{ t('skills.builtin') }}</span>
          <span class="stat-value">{{ store.stats.builtin }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('skills.user') }}</span>
          <span class="stat-value">{{ store.stats.user }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('skills.project') }}</span>
          <span class="stat-value">{{ store.stats.project }}</span>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="skills-main">

      <!-- Tab: Local Skills -->
      <div v-if="activeTab === 'local'">
        <div class="section-header-row">
          <div>
            <h2>{{ t('skills.localTitle') }}</h2>
            <p class="section-desc">{{ t('skills.localDesc') }}</p>
          </div>
          <a-button type="primary" @click="openCreateModal">+ {{ t('skills.create') }}</a-button>
        </div>

        <div v-if="store.loading" class="loading-state">
          <a-spin />
        </div>

        <div v-else-if="store.skills.length === 0" class="empty-state">
          {{ t('common.noData') }}
        </div>

        <div v-else class="skills-list">
          <div
            v-for="skill in store.skills"
            :key="skill.name"
            class="skill-card"
            :class="{ 'is-builtin': skill.source === 'builtin' }"
          >
            <div class="skill-card-header">
              <div class="skill-info">
                <span class="skill-name">{{ skill.name }}</span>
                <span class="skill-source" :class="skill.source">{{ sourceLabel(skill.source) }}</span>
              </div>
              <div class="skill-actions" v-if="skill.source !== 'builtin'">
                <a-button
                  type="text"
                  status="danger"
                  size="small"
                  @click="confirmDelete(skill.name)"
                >{{ t('common.delete') }}</a-button>
              </div>
            </div>
            <div class="skill-description">{{ skill.description }}</div>
            <div class="skill-prompt-preview" v-if="expandedSkill === skill.name">
              <pre>{{ skill.prompt }}</pre>
              <pre v-if="skill.system" class="skill-system">{{ skill.system }}</pre>
            </div>
            <a-button
              type="text"
              size="small"
              class="expand-btn"
              @click="toggleExpand(skill.name)"
            >{{ expandedSkill === skill.name ? t('skills.collapse') : t('skills.expand') }}</a-button>
          </div>
        </div>
      </div>

      <!-- Tab: SkillHub -->
      <div v-if="activeTab === 'hub'">
        <div class="section-header-row">
          <div>
            <h2>{{ t('skills.hubTitle') }}</h2>
            <p class="section-desc">{{ t('skills.hubDesc') }}</p>
          </div>
        </div>

        <div class="hub-search-bar">
          <a-input-search
            v-model="hubQuery"
            :placeholder="t('skills.hubSearchPlaceholder')"
            :loading="store.hubLoading"
            search-button
            @search="doHubSearch"
            @press-enter="doHubSearch"
          />
        </div>

        <div v-if="store.hubLoading" class="loading-state">
          <a-spin />
        </div>
        <div v-else-if="hubSearched && store.hubResults.length === 0" class="empty-state">
          {{ t('skills.hubNoResults') }}
        </div>
        <div v-else-if="!hubSearched" class="hub-hint">
          {{ t('skills.hubHint') }}
        </div>
        <div v-else class="skills-list">
          <div
            v-for="skill in store.hubResults"
            :key="skill.name"
            class="skill-card hub-skill"
          >
            <div class="skill-card-header">
              <div class="skill-info">
                <span class="skill-name">{{ skill.name }}</span>
                <span v-if="skill.author" class="skill-author">by {{ skill.author }}</span>
                <span v-if="skill.downloads !== undefined" class="skill-downloads">⬇ {{ skill.downloads }}</span>
              </div>
              <a-button
                type="primary"
                size="small"
                @click="installSkill(skill)"
                :loading="installing === skill.name"
              >{{ t('skills.install') }}</a-button>
            </div>
            <div class="skill-description">{{ skill.description }}</div>
            <div class="skill-tags" v-if="skill.tags?.length">
              <a-tag v-for="tag in skill.tags" :key="tag" size="small">{{ tag }}</a-tag>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Create Skill Modal -->
    <a-modal
      v-model:visible="showCreateModal"
      :title="t('skills.createTitle')"
      :ok-loading="creating"
      @ok="submitCreate"
      @cancel="resetForm"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item :label="t('common.name')" required>
          <a-input v-model="createForm.name" :placeholder="t('skills.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('common.description')" required>
          <a-input v-model="createForm.description" :placeholder="t('skills.descPlaceholder')" />
        </a-form-item>
        <a-form-item label="Prompt" required>
          <a-textarea
            v-model="createForm.prompt"
            :auto-size="{ minRows: 3, maxRows: 8 }"
            :placeholder="t('skills.promptPlaceholder')"
          />
        </a-form-item>
        <a-form-item label="System Prompt（可选）">
          <a-textarea
            v-model="createForm.system"
            :auto-size="{ minRows: 2, maxRows: 5 }"
            :placeholder="t('skills.systemPlaceholder')"
          />
        </a-form-item>
      </a-form>
    </a-modal>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Message, Modal } from '@arco-design/web-vue';
import { useSkillsStore } from '@/stores/skills';
import type { ApiHubSkill } from '@/api/client';
import { skillsApi } from '@/api/client';

const { t } = useI18n();
const store = useSkillsStore();

const activeTab = ref('local');
const expandedSkill = ref<string | null>(null);
const showCreateModal = ref(false);
const creating = ref(false);
const hubQuery = ref('');
const hubSearched = ref(false);
const installing = ref<string | null>(null);

const createForm = ref({
  name: '',
  description: '',
  prompt: '',
  system: '',
});

const tabs = [
  { id: 'local', icon: '📦', label: t('skills.tabLocal') },
  { id: 'hub',   icon: '🌐', label: 'SkillHub' },
];

function sourceLabel(source: string) {
  const map: Record<string, string> = { builtin: t('skills.builtin'), user: t('skills.user'), project: t('skills.project') };
  return map[source] ?? source;
}

function toggleExpand(name: string) {
  expandedSkill.value = expandedSkill.value === name ? null : name;
}

function openCreateModal() {
  resetForm();
  showCreateModal.value = true;
}

function resetForm() {
  createForm.value = { name: '', description: '', prompt: '', system: '' };
  showCreateModal.value = false;
}

async function submitCreate() {
  const { name, description, prompt, system } = createForm.value;
  if (!name.trim() || !description.trim() || !prompt.trim()) {
    Message.warning(t('skills.formRequired'));
    return;
  }
  creating.value = true;
  try {
    await store.createSkill({
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      ...(system.trim() && { system: system.trim() }),
    });
    Message.success(t('skills.createSuccess'));
    resetForm();
  } catch (err) {
    Message.error((err instanceof Error ? err.message : String(err)) || t('common.error'));
  } finally {
    creating.value = false;
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
        Message.success(t('skills.deleteSuccess'));
      } catch (err) {
        Message.error((err instanceof Error ? err.message : String(err)) || t('common.error'));
      }
    },
  });
}

async function doHubSearch() {
  if (!hubQuery.value.trim()) return;
  hubSearched.value = true;
  await store.searchHub(hubQuery.value.trim());
}

async function installSkill(skill: ApiHubSkill) {
  installing.value = skill.name;
  try {
    // Install via hub endpoint by creating the skill locally from hub data
    await skillsApi.create({
      name: skill.name,
      description: skill.description,
      prompt: skill.prompt,
      ...(skill.system !== undefined && { system: skill.system }),
    });
    await store.fetchSkills();
    Message.success(t('skills.installSuccess', { name: skill.name }));
  } catch (err) {
    Message.error((err instanceof Error ? err.message : String(err)) || t('common.error'));
  } finally {
    installing.value = null;
  }
}

onMounted(() => {
  store.fetchSkills();
});
</script>

<style scoped>
.skills-view {
  display: flex;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-1);
}

.sub-panel {
  width: 200px;
  min-width: 160px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-2);
}

.sub-header {
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--color-border);
}

.sub-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.skills-nav {
  padding: 8px 0;
  flex: 1;
}

.sn-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-2);
  border-radius: 6px;
  margin: 2px 8px;
  transition: background 0.15s;
}
.sn-item:hover { background: var(--color-fill-2); }
.sn-item.active { background: var(--color-primary-light-1); color: rgb(var(--primary-6)); font-weight: 500; }

.sn-icon { font-size: 14px; }

.skills-stats {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.stat-label { color: var(--color-text-3); }
.stat-value { color: var(--color-text-1); font-weight: 500; }

.skills-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.section-header-row h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-1);
}

.section-desc {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-3);
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 48px 0;
  color: var(--color-text-3);
}

.hub-hint {
  text-align: center;
  padding: 48px 0;
  color: var(--color-text-3);
  font-size: 14px;
}

.hub-search-bar {
  margin-bottom: 20px;
  max-width: 480px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg-2);
  transition: box-shadow 0.15s;
}
.skill-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.skill-card.is-builtin { opacity: 0.85; }

.skill-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.skill-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
  font-family: monospace;
}

.skill-source {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 500;
}
.skill-source.builtin { background: var(--color-fill-3); color: var(--color-text-3); }
.skill-source.user    { background: var(--color-primary-light-1); color: rgb(var(--primary-6)); }
.skill-source.project { background: var(--color-success-light-1); color: rgb(var(--success-6)); }

.skill-author { font-size: 12px; color: var(--color-text-3); }
.skill-downloads { font-size: 12px; color: var(--color-text-3); }

.skill-description {
  font-size: 13px;
  color: var(--color-text-2);
  margin-bottom: 6px;
}

.skill-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.skill-prompt-preview {
  margin-top: 8px;
  border-top: 1px solid var(--color-border);
  padding-top: 8px;
}
.skill-prompt-preview pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-2);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-fill-1);
  padding: 8px;
  border-radius: 4px;
}
.skill-system {
  margin-top: 8px !important;
  border: 1px solid var(--color-warning-light-3);
}

.expand-btn {
  padding: 0;
  font-size: 12px;
  color: var(--color-text-3);
}
</style>
