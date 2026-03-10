<template>
  <div class="workers-view">
    <!-- Sub panel -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.workers') }}</span>
        <a-button type="primary" size="mini" shape="circle" @click="openCreate">
          <template #icon><icon-plus /></template>
        </a-button>
      </div>
      <div class="sub-search">
        <a-input v-model="searchText" :placeholder="t('common.search')" size="small" allow-clear>
          <template #prefix><icon-search /></template>
        </a-input>
      </div>
      <div class="worker-list">
        <div
          v-for="w in filteredWorkers"
          :key="w.id"
          class="worker-list-item"
          :class="{ active: selectedId === w.id }"
          @click="selectedId = w.id"
        >
          <span class="wl-avatar">{{ w.avatar }}</span>
          <div class="wl-info">
            <div class="wl-name">{{ w.name }}</div>
            <div class="wl-model">{{ w.modelId }}</div>
          </div>
          <div class="wl-status-dot" :class="w.status"></div>
        </div>
      </div>
    </div>

    <!-- Detail / grid area -->
    <div class="workers-main">
      <template v-if="selectedWorker">
        <!-- Worker detail card -->
        <div class="worker-detail">
          <div class="detail-header">
            <div class="detail-avatar">{{ selectedWorker.avatar }}</div>
            <div class="detail-info">
              <h2>{{ selectedWorker.name }}</h2>
              <p>{{ selectedWorker.description }}</p>
              <div class="detail-tags">
                <a-tag v-for="skill in selectedWorker.skills" :key="skill" color="arcoblue" size="small">
                  {{ skill }}
                </a-tag>
              </div>
            </div>
            <div class="detail-actions">
              <a-button type="primary" @click="startChat(selectedWorker.id)">
                <template #icon><icon-message /></template>
                {{ t('workers.startChat') }}
              </a-button>
              <a-button type="outline" @click="openEdit(selectedWorker)">
                <template #icon><icon-edit /></template>
                {{ t('common.edit') }}
              </a-button>
              <a-button status="danger" type="outline" @click="confirmDelete(selectedWorker.id)">
                <template #icon><icon-delete /></template>
                {{ t('common.delete') }}
              </a-button>
            </div>
          </div>

          <a-divider />

          <!-- Stats -->
          <div class="detail-stats">
            <div class="stat-card">
              <div class="stat-value">{{ formatNumber(selectedWorker.totalTokens) }}</div>
              <div class="stat-label">{{ t('workers.totalTokens') }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ selectedWorker.totalSessions }}</div>
              <div class="stat-label">{{ t('workers.totalSessions') }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">
                <a-tag :color="statusColor(selectedWorker.status)">
                  {{ t(`workers.${selectedWorker.status}`) }}
                </a-tag>
              </div>
              <div class="stat-label">{{ t('workers.workerStatus') }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ selectedWorker.lastActive }}</div>
              <div class="stat-label">{{ t('workers.lastActive') }}</div>
            </div>
          </div>

          <a-divider />

          <!-- Configuration -->
          <div class="detail-section">
            <h3>{{ t('workers.workerModel') }}</h3>
            <a-tag color="purple">{{ selectedWorker.modelId }}</a-tag>
          </div>

          <div class="detail-section">
            <h3>{{ t('workers.workerRole') }}</h3>
            <div class="role-text">{{ selectedWorker.role }}</div>
          </div>

          <div class="detail-section" v-if="selectedWorker.tools.length">
            <h3>{{ t('workers.workerTools') }}</h3>
            <div class="detail-tags">
              <a-tag
                v-for="tool in selectedWorker.tools"
                :key="tool"
                color="orange"
                size="small"
              >{{ tool }}</a-tag>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- All workers grid -->
        <div class="workers-grid-header">
          <h2>{{ t('workers.title') }}</h2>
          <a-button type="primary" @click="openCreate">
            <template #icon><icon-plus /></template>
            {{ t('workers.createWorker') }}
          </a-button>
        </div>

        <div class="workers-grid">
          <div
            v-for="w in workersStore.workers"
            :key="w.id"
            class="worker-card"
            @click="selectedId = w.id"
          >
            <div class="card-avatar">{{ w.avatar }}</div>
            <div class="card-name">{{ w.name }}</div>
            <div class="card-desc">{{ w.description }}</div>
            <div class="card-skills">
              <a-tag v-for="s in w.skills.slice(0, 2)" :key="s" size="small" color="arcoblue">{{ s }}</a-tag>
              <span v-if="w.skills.length > 2" class="more-skills">+{{ w.skills.length - 2 }}</span>
            </div>
            <a-divider style="margin: 12px 0" />
            <div class="card-stats">
              <div class="card-stat">
                <div class="cs-val">{{ formatNumber(w.totalTokens) }}</div>
                <div class="cs-label">Tokens</div>
              </div>
              <div class="card-stat">
                <div class="cs-val">{{ w.totalSessions }}</div>
                <div class="cs-label">{{ t('workers.totalSessions') }}</div>
              </div>
              <div class="card-stat">
                <a-tag :color="statusColor(w.status)" size="small">
                  {{ t(`workers.${w.status}`) }}
                </a-tag>
              </div>
            </div>
            <div class="card-chat-btn" @click.stop="startChat(w.id)">
              <icon-message style="margin-right:4px" />{{ t('workers.startChat') }}
            </div>
          </div>

          <!-- Add card -->
          <div class="worker-card add-card" @click="openCreate">
            <icon-plus class="add-icon" />
            <span>{{ t('workers.createWorker') }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- Create / Edit Modal -->
  <a-modal
    v-model:visible="showModal"
    :title="editingWorker ? t('workers.editWorker') : t('workers.createWorker')"
    width="560px"
    @ok="handleSave"
    @cancel="showModal = false"
    :ok-text="t('common.save')"
    :cancel-text="t('common.cancel')"
  >
    <a-form :model="form" layout="vertical">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item :label="t('workers.workerName')" required>
            <a-input v-model="form.name" :placeholder="t('workers.namePlaceholder')" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item :label="t('workers.workerModel')" required>
            <a-select v-model="form.modelId" :placeholder="t('workers.modelPlaceholder')">
              <a-option
                v-for="m in workersStore.AVAILABLE_MODELS"
                :key="m.id"
                :value="m.id"
              >{{ m.label }}</a-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item :label="t('workers.workerDescription')">
        <a-input v-model="form.description" :placeholder="t('workers.descPlaceholder')" />
      </a-form-item>

      <a-form-item :label="t('workers.workerRole')">
        <a-textarea
          v-model="form.role"
          :placeholder="t('workers.rolePlaceholder')"
          :auto-size="{ minRows: 3, maxRows: 6 }"
        />
      </a-form-item>

      <a-form-item :label="t('workers.workerTools')">
        <a-checkbox-group v-model="form.tools">
          <a-checkbox
            v-for="tool in workersStore.AVAILABLE_TOOLS"
            :key="tool.id"
            :value="tool.id"
          >{{ tool.label }}</a-checkbox>
        </a-checkbox-group>
      </a-form-item>

      <a-form-item :label="t('workers.workerSkills')">
        <a-input-tag v-model="form.skills" :placeholder="t('common.create') + '...'" allow-clear />
      </a-form-item>

      <a-form-item label="Avatar">
        <div class="avatar-picker">
          <span
            v-for="emoji in avatarOptions"
            :key="emoji"
            class="avatar-option"
            :class="{ selected: form.avatar === emoji }"
            @click="form.avatar = emoji"
          >{{ emoji }}</span>
        </div>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useWorkersStore } from '@/stores/workers';
import { useChatStore } from '@/stores/chat';
import { Modal, Message } from '@arco-design/web-vue';
import type { MockWorker } from '@/mock/data';

const { t } = useI18n();
const router = useRouter();
const workersStore = useWorkersStore();
const chatStore = useChatStore();

const searchText = ref('');
const selectedId = ref<string | null>(null);
const showModal = ref(false);
const editingWorker = ref<MockWorker | null>(null);

const avatarOptions = ['🤖', '🔬', '💻', '✍️', '📊', '🎯', '🚀', '💡', '🧠', '🎨', '📋', '🔭'];

const form = reactive({
  name: '',
  description: '',
  modelId: 'claude-sonnet-4-6',
  role: '',
  skills: [] as string[],
  tools: [] as string[],
  avatar: '🤖',
});

const selectedWorker = computed(() =>
  selectedId.value ? workersStore.getWorker(selectedId.value) : null
);

const filteredWorkers = computed(() => {
  if (!searchText.value) return workersStore.workers;
  const s = searchText.value.toLowerCase();
  return workersStore.workers.filter(w =>
    w.name.toLowerCase().includes(s) || w.description.toLowerCase().includes(s)
  );
});

function statusColor(status: string) {
  return { online: 'green', idle: 'orange', offline: 'gray' }[status] || 'gray';
}

function formatNumber(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function openCreate() {
  editingWorker.value = null;
  Object.assign(form, {
    name: '', description: '', modelId: 'claude-sonnet-4-6',
    role: '', skills: [], tools: [], avatar: '🤖',
  });
  showModal.value = true;
}

function openEdit(worker: MockWorker) {
  editingWorker.value = worker;
  Object.assign(form, {
    name: worker.name,
    description: worker.description,
    modelId: worker.modelId,
    role: worker.role,
    skills: [...worker.skills],
    tools: [...worker.tools],
    avatar: worker.avatar,
  });
  showModal.value = true;
}

function handleSave() {
  if (!form.name.trim()) {
    Message.error(t('workers.workerName') + ' ' + t('common.noData'));
    return;
  }
  if (editingWorker.value) {
    workersStore.updateWorker(editingWorker.value.id, { ...form });
    Message.success(t('common.success'));
  } else {
    workersStore.createWorker({ ...form });
    Message.success(t('common.success'));
  }
  showModal.value = false;
}

function startChat(workerId: string) {
  chatStore.openWorkerChat(workerId);
  router.push('/chat');
}

function confirmDelete(id: string) {
  Modal.confirm({
    title: t('workers.confirmDelete'),
    content: t('workers.deleteWarning'),

    onOk() {
      workersStore.deleteWorker(id);
      selectedId.value = null;
      Message.success(t('common.success'));
    },
  });
}
</script>

<style scoped>
.workers-view {
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
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.sub-search {
  padding: 0 12px 12px;
}

.worker-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.worker-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
}

.worker-list-item:hover { background: rgba(22, 93, 255, 0.05); }
.worker-list-item.active { background: rgba(22, 93, 255, 0.1); }

.wl-avatar { font-size: 22px; flex-shrink: 0; }

.wl-info { flex: 1; min-width: 0; }

.wl-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wl-model {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wl-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wl-status-dot.online { background: #00b42a; }
.wl-status-dot.idle { background: #ff7d00; }
.wl-status-dot.offline { background: #86909c; }

/* ─── Workers Main ───────────────────────────────────────────────────── */

.workers-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg-card);
}

/* Grid */
.workers-grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.workers-grid-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.workers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.worker-card {
  background: var(--bg-base);
  border-radius: 16px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid var(--border-color);
}

.worker-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  border-color: #165dff;
}

.card-avatar {
  font-size: 40px;
  margin-bottom: 12px;
}

.card-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.more-skills {
  font-size: 11px;
  color: var(--text-tertiary);
  align-self: center;
}

.card-stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-stat { text-align: center; }

.cs-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cs-label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--border-color);
  color: var(--text-tertiary);
  font-size: 14px;
  min-height: 200px;
}

.add-card:hover {
  border-color: #165dff;
  color: #165dff;
  background: rgba(22, 93, 255, 0.03);
}

.add-icon {
  font-size: 32px;
}

.card-chat-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  padding: 7px 0;
  border-radius: 8px;
  background: rgba(22, 93, 255, 0.06);
  color: #165dff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
  border: 1px solid rgba(22, 93, 255, 0.15);
}

.card-chat-btn:hover {
  background: rgba(22, 93, 255, 0.12);
}

/* ─── Detail ──────────────────────────────────────────────────────────── */

.worker-detail {
  max-width: 700px;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

.detail-avatar {
  font-size: 60px;
  line-height: 1;
  flex-shrink: 0;
}

.detail-info {
  flex: 1;
}

.detail-info h2 {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.detail-info p {
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: var(--bg-base);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.role-text {
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-base);
  border-radius: 10px;
  padding: 14px;
  line-height: 1.7;
  border: 1px solid var(--border-color);
}

/* Avatar picker */
.avatar-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.avatar-option {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  cursor: pointer;
  border: 2px solid transparent;
  background: var(--bg-base);
  transition: all 0.15s;
}

.avatar-option:hover { border-color: #165dff; }
.avatar-option.selected { border-color: #165dff; background: rgba(22, 93, 255, 0.1); }
</style>
