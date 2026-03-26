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
          <span class="wl-avatar">{{ workerAvatar(w) }}</span>
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
        <!-- Worker detail card (tabbed, decoupled) -->
        <div class="worker-detail">

          <!-- ── Profile header ── -->
          <div class="detail-profile">
            <!-- Avatar with inline picker (Arco popover) -->
            <a-popover v-model:popup-visible="showAvatarPicker" trigger="click" position="bottom">
              <div class="detail-avatar-wrap" title="点击更换头像">
                <div class="detail-avatar">{{ workerAvatar(selectedWorker) }}</div>
                <div class="avatar-hover-hint"><icon-camera style="font-size:12px" /></div>
              </div>
              <template #content>
                <div class="avatar-picker-grid">
                  <span
                    v-for="emoji in avatarOptions"
                    :key="emoji"
                    class="avatar-picker-opt"
                    :class="{ selected: workerAvatar(selectedWorker) === emoji }"
                    @click="pickAvatar(emoji)"
                  >{{ emoji }}</span>
                </div>
              </template>
            </a-popover>

            <div class="detail-meta">
              <div class="detail-name-row">
                <h2 class="detail-name">{{ selectedWorker.name }}</h2>
                <a-tag v-if="selectedWorker.isPrimary" color="arcoblue" size="small">主 Worker</a-tag>
                <a-tag :color="statusColor(selectedWorker.status)" size="small">{{ t(`workers.${selectedWorker.status}`) }}</a-tag>
              </div>
              <div class="detail-id">{{ selectedWorker.id }}</div>
              <div v-if="selectedWorker.description" class="detail-desc">{{ selectedWorker.description }}</div>
            </div>

            <div class="detail-actions">
              <a-button type="primary" size="small" @click="startChat(selectedWorker.id)">
                <template #icon><icon-message /></template>
                {{ t('workers.startChat') }}
              </a-button>
              <a-button type="outline" size="small" @click="openEdit(selectedWorker)">
                <template #icon><icon-edit /></template>
                {{ t('common.edit') }}
              </a-button>
              <a-button status="danger" type="text" size="small" @click="confirmDelete(selectedWorker.id)">
                <template #icon><icon-delete /></template>
              </a-button>
            </div>
          </div>

          <!-- ── Tabs ── -->
          <a-tabs v-model:active-key="detailTab" size="small" class="detail-tabs" @change="onTabChange">

            <!-- Tab: 概览 -->
            <a-tab-pane key="overview" title="概览">
              <div class="tab-body">
                <div class="info-section">
                  <div class="info-section-title">模型</div>
                  <div class="info-row">
                    <span class="info-label">主模型</span>
                    <a-tag color="purple" size="small">{{ selectedWorker.modelId }}</a-tag>
                  </div>
                  <div v-if="selectedWorker.reviewModelId" class="info-row">
                    <span class="info-label">审视模型</span>
                    <a-tag color="arcoblue" size="small">{{ selectedWorker.reviewModelId }}</a-tag>
                  </div>
                  <div class="info-row">
                    <span class="info-label">心跳</span>
                    <a-tag :color="selectedWorker.heartbeatIntervalMs === 0 ? 'gray' : 'green'" size="small">
                      {{ selectedWorker.heartbeatIntervalMs === 0 ? '被动唤起' : `主动轮询 · ${(selectedWorker.heartbeatIntervalMs ?? 30000) / 1000}s` }}
                    </a-tag>
                  </div>
                </div>

                <div class="info-section">
                  <div class="info-section-title">角色定义</div>
                  <div class="role-text">{{ selectedWorker.role || '（未设置）' }}</div>
                </div>

                <div v-if="selectedWorker.capabilities" class="info-section">
                  <div class="info-section-title">能力配置</div>
                  <div class="cap-list">
                    <div v-if="selectedWorker.capabilities.browser !== undefined" class="cap-item">
                      <div class="cap-item-header">
                        <span class="cap-icon">🌐</span>
                        <span class="cap-name">浏览器访问</span>
                        <a-tag :color="selectedWorker.capabilities.browser ? 'green' : 'gray'" size="small">
                          {{ selectedWorker.capabilities.browser ? '已启用' : '已禁用' }}
                        </a-tag>
                      </div>
                      <template v-if="selectedWorker.capabilities.browser && typeof selectedWorker.capabilities.browser === 'object'">
                        <div class="cap-config">
                          <span v-if="selectedWorker.capabilities.browser.headless !== undefined">
                            {{ selectedWorker.capabilities.browser.headless ? '无头模式' : '有界面模式' }}
                          </span>
                          <span v-if="selectedWorker.capabilities.browser.timeout">
                            超时 {{ selectedWorker.capabilities.browser.timeout / 1000 }}s
                          </span>
                          <span v-if="selectedWorker.capabilities.browser.screenshotDir">
                            截图目录：<code>{{ selectedWorker.capabilities.browser.screenshotDir }}</code>
                          </span>
                        </div>
                        <div v-if="selectedWorker.capabilities.browser.allowedUrls?.length" class="cap-allowed-urls">
                          允许 URL：
                          <code v-for="u in selectedWorker.capabilities.browser.allowedUrls" :key="u" class="url-chip">{{ u }}</code>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </a-tab-pane>

            <!-- Tab: 技能 -->
            <a-tab-pane key="skills" :title="`技能 (${selectedWorker.skills.length})`">
              <div class="tab-body">
                <div v-if="selectedWorker.skills.length === 0" class="tab-empty">
                  <p>尚未配置技能</p>
                  <a-button size="small" type="outline" @click="openEdit(selectedWorker)">
                    <template #icon><icon-plus /></template>添加技能
                  </a-button>
                </div>
                <div v-else class="skill-cards">
                  <div v-for="skillName in selectedWorker.skills" :key="skillName" class="skill-card">
                    <div class="skill-card-header">
                      <span class="skill-card-name">{{ skillName }}</span>
                      <a-tag size="small" color="arcoblue">{{ getSkillSourceLabel(skillName) }}</a-tag>
                    </div>
                    <div class="skill-card-desc">{{ getSkillDescription(skillName) || '（无描述）' }}</div>
                  </div>
                </div>
              </div>
            </a-tab-pane>

            <!-- Tab: 工具 -->
            <a-tab-pane key="tools" :title="`工具 (${selectedWorker.tools.length})`">
              <div class="tab-body">
                <div class="tools-grid">
                  <div
                    v-for="tool in workersStore.AVAILABLE_TOOLS"
                    :key="tool.id"
                    class="tool-row"
                    :class="{ 'tool-enabled': selectedWorker.tools.includes(tool.id) }"
                  >
                    <span class="tool-dot" :class="{ enabled: selectedWorker.tools.includes(tool.id) }"></span>
                    <div class="tool-row-info">
                      <span class="tool-row-label">{{ tool.label }}</span>
                      <span class="tool-row-id">{{ tool.id }}</span>
                    </div>
                    <a-tag v-if="selectedWorker.tools.includes(tool.id)" size="small" color="green">已启用</a-tag>
                    <a-tag v-else size="small" color="gray">未启用</a-tag>
                  </div>
                </div>
                <div style="margin-top: 12px; text-align: right;">
                  <a-button size="mini" type="text" @click="openEdit(selectedWorker)">
                    <template #icon><icon-edit /></template>修改工具配置
                  </a-button>
                </div>
              </div>
            </a-tab-pane>

            <!-- Tab: 工作空间 -->
            <a-tab-pane key="workspace" title="工作空间">
              <div class="tab-body">
                <!-- Directory path (inline editable) -->
                <div class="ws-path-row">
                  <icon-folder style="color: #165dff; flex-shrink: 0;" />
                  <template v-if="!editingWorkspacePath">
                    <code class="ws-path-code">{{ selectedWorker.workspace }}</code>
                    <a-button size="mini" type="text" title="修改目录" @click="startEditWorkspacePath(selectedWorker.workspace)">
                      <template #icon><icon-edit /></template>
                    </a-button>
                  </template>
                  <template v-else>
                    <a-input v-model="newWorkspacePath" size="small" style="flex: 1" allow-clear />
                    <a-button size="mini" type="primary" :loading="savingWorkspace" @click="saveWorkspacePath(selectedWorker.id)">保存</a-button>
                    <a-button size="mini" type="text" @click="cancelEditWorkspacePath">取消</a-button>
                  </template>
                </div>
                <a-divider style="margin: 10px 0" />

                <div class="workspace-refresh-row">
                  <span class="info-section-title" style="margin-bottom: 0; flex: 1">文件列表</span>
                  <a-button size="mini" type="text" :loading="wsLoading" @click="loadWorkspace(selectedWorker.id)">
                    <template #icon><icon-refresh /></template>刷新
                  </a-button>
                </div>

                <div v-if="wsLoading" class="ws-loading"><a-spin size="small" /></div>

                <template v-else-if="wsInfo">
                  <div v-if="wsInfo.files.length === 0" class="ws-empty">{{ t('workers.workspaceEmpty') }}</div>
                  <div v-else class="ws-file-list">
                    <div v-for="f in wsInfo.files" :key="f.path" class="ws-file-item">
                      <span class="ws-file-icon">{{ f.isDir ? '📁' : '📄' }}</span>
                      <span class="ws-file-name">{{ f.path }}</span>
                      <span class="ws-file-size">{{ formatFileSize(f.size) }}</span>
                      <span class="ws-file-date">{{ formatDate(f.mtime) }}</span>
                      <div class="ws-file-actions" v-if="!f.isDir">
                        <a :href="workspaceApi.fileUrl(selectedWorker.id, f.path)" :download="f.name" class="ws-download-btn">
                          <icon-download />
                        </a>
                        <a-popconfirm
                          :content="t('workers.confirmDeleteFile')"
                          @ok="deleteWorkspaceFile(selectedWorker.id, f.path)"
                        >
                          <a-button size="mini" type="text" status="danger">
                            <template #icon><icon-delete /></template>
                          </a-button>
                        </a-popconfirm>
                      </div>
                    </div>
                  </div>

                  <template v-if="wsInfo.sharedFiles.length > 0">
                    <div class="ws-dir-label" style="margin-top: 16px">
                      <icon-folder style="color: #ff7d00" />
                      <span>{{ t('workers.sharedDir') }}：<code>{{ wsInfo.sharedDir }}</code></span>
                      <a-tag size="mini" color="orange" style="margin-left: 4px">{{ t('workers.readOnly') }}</a-tag>
                    </div>
                    <div class="ws-file-list">
                      <div v-for="f in wsInfo.sharedFiles" :key="f.path" class="ws-file-item">
                        <span class="ws-file-icon">{{ f.isDir ? '📁' : '📄' }}</span>
                        <span class="ws-file-name">{{ f.path }}</span>
                        <span class="ws-file-size">{{ formatFileSize(f.size) }}</span>
                        <span class="ws-file-date">{{ formatDate(f.mtime) }}</span>
                        <div class="ws-file-actions" v-if="!f.isDir">
                          <a :href="workspaceApi.sharedFileUrl(f.path)" :download="f.name" class="ws-download-btn">
                            <icon-download />
                          </a>
                        </div>
                      </div>
                    </div>
                  </template>
                </template>
              </div>
            </a-tab-pane>

            <!-- Tab: 待办 -->
            <a-tab-pane key="todos" :title="selectedWorker.skills.includes('todolist') ? `待办 (${workerTasks.length})` : '待办'">
              <div class="tab-body">
                <template v-if="selectedWorker.skills.includes('todolist')">
                  <div v-if="tasksLoading" class="ws-loading"><a-spin size="small" /></div>
                  <div v-else-if="workerTasks.length === 0" class="tab-empty">
                    <p>暂无待办任务</p>
                  </div>
                  <div v-else class="task-list">
                    <div v-for="task in workerTasks" :key="task.id" class="task-item">
                      <div class="task-item-header">
                        <span class="task-item-title">{{ task.title }}</span>
                        <div class="task-item-badges">
                          <a-tag size="small" :color="taskStatusColor(task.status)">{{ taskStatusLabel(task.status) }}</a-tag>
                          <a-tag size="small" :color="taskPriorityColor(task.priority)">{{ task.priority }}</a-tag>
                        </div>
                      </div>
                      <div v-if="task.description" class="task-item-desc">{{ task.description }}</div>
                      <div class="task-item-meta">{{ formatDate(task.updatedAt) }}</div>
                    </div>
                  </div>
                </template>
                <div v-else class="tab-empty">
                  <p style="font-size: 13px; color: var(--text-secondary)">需要 <code>todolist</code> 技能以启用任务管理</p>
                  <a-button size="small" type="outline" @click="openEdit(selectedWorker)">
                    <template #icon><icon-edit /></template>编辑技能
                  </a-button>
                </div>
              </div>
            </a-tab-pane>

          </a-tabs>
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
            <div class="card-avatar">{{ workerAvatar(w) }}</div>
            <div class="card-name">{{ w.name }}</div>
            <div class="card-id" style="font-size: 11px; color: var(--text-secondary); margin: -6px 0 4px; font-family: monospace;">{{ w.id }}</div>
            <div class="card-desc">{{ w.description }}</div>
            <div class="card-skills">
              <a-tag v-for="s in w.skills.slice(0, 2)" :key="s" size="small" color="arcoblue">{{ s }}</a-tag>
              <span v-if="w.skills.length > 2" class="more-skills">+{{ w.skills.length - 2 }}</span>
            </div>
            <a-divider style="margin: 12px 0" />
            <div class="card-stats">
              <div class="card-stat">
                <div class="cs-val">{{ w.modelId }}</div>
                <div class="cs-label">模型</div>
              </div>
              <div class="card-stat">
                <div class="cs-val">{{ w.tools.length }}</div>
                <div class="cs-label">{{ t('workers.tools') }}</div>
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
    width="580px"
    :ok-text="t('common.save')"
    :cancel-text="t('common.cancel')"
    :ok-loading="saving"
    @ok="handleSave"
    @cancel="showModal = false"
  >
    <a-form :model="form" layout="vertical">
      <a-row :gutter="16">
        <a-col :span="editingWorker ? 18 : 24">
          <a-form-item :label="t('workers.workerName')" required>
            <a-input v-model="form.name" :placeholder="t('workers.namePlaceholder')" />
          </a-form-item>
        </a-col>
        <!-- 编辑时只读展示员工号（新建时不显示，由系统自动生成） -->
        <a-col v-if="editingWorker" :span="6">
          <a-form-item label="员工号">
            <a-input :model-value="form.id" disabled />
          </a-form-item>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :span="16">
          <a-form-item :label="t('workers.workerModel')" required>
            <a-select v-model="form.modelId" :placeholder="t('workers.modelPlaceholder')">
              <a-option
                v-for="m in modelsStore.models"
                :key="m.id"
                :value="m.id"
              >{{ m.displayName }}</a-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label=" " style="padding-top: 8px">
            <a-checkbox v-model="form.isPrimary">设为主 Worker</a-checkbox>
          </a-form-item>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :span="24">
          <a-form-item label="审视模型（可选）">
            <a-select
              v-model="form.reviewModelId"
              placeholder="不设置则与主模型相同（心跳/收件箱处理用）"
              allow-clear
            >
              <a-option value="">不使用独立审视模型</a-option>
              <a-option
                v-for="m in modelsStore.models"
                :key="m.id"
                :value="m.id"
              >{{ m.displayName }}（{{ m.id }}）</a-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="心跳模式">
            <a-radio-group v-model="form.heartbeatMode" type="button">
              <a-radio value="active">主动轮询</a-radio>
              <a-radio value="passive">被动唤起</a-radio>
            </a-radio-group>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item v-if="form.heartbeatMode === 'active'" label="轮询间隔（秒）">
            <a-input-number
              v-model="form.heartbeatIntervalSec"
              :min="1"
              :max="3600"
              :step="5"
              placeholder="默认 30"
              style="width: 100%"
            />
          </a-form-item>
          <a-form-item v-else label=" " style="padding-top: 8px">
            <span style="font-size: 12px; color: var(--color-text-3)">仅在收到消息时处理，不启动定时器</span>
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

      <a-form-item
        v-if="hasWorkspaceTools"
        :label="t('workers.workspaceDir')"
        :extra="t('workers.workspaceDirHint')"
      >
        <a-input
          v-model="form.workspace"
          :placeholder="t('workers.workspaceDirPlaceholder')"
          allow-clear
        />
      </a-form-item>

      <a-form-item :label="t('workers.workerSkills')">
        <a-select
          v-model="form.skills"
          multiple
          allow-search
          allow-clear
          :max-tag-count="3"
          :placeholder="t('workers.skillsPlaceholder')"
        >
          <a-option
            v-for="opt in skillOptions"
            :key="opt.value"
            :value="opt.value"
          >
            <span style="font-weight: 500">{{ opt.label }}</span>
            <span v-if="opt.extra" style="margin-left: 6px; font-size: 12px; color: var(--color-text-3)">{{ opt.extra }}</span>
          </a-option>
        </a-select>
      </a-form-item>

      <!-- Capabilities -->
      <a-form-item label="能力配置">
        <div class="cap-form-section">
          <div class="cap-form-item">
            <div class="cap-form-header">
              <a-switch v-model="form.capBrowserEnabled" size="small" />
              <span class="cap-form-label">🌐 浏览器访问</span>
            </div>
            <div v-if="form.capBrowserEnabled" class="cap-form-body">
              <a-row :gutter="12">
                <a-col :span="12">
                  <a-form-item label="模式" :style="{ marginBottom: '8px' }">
                    <a-radio-group v-model="form.capBrowserHeadless" type="button" size="small">
                      <a-radio :value="true">无头（推荐）</a-radio>
                      <a-radio :value="false">有界面</a-radio>
                    </a-radio-group>
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="超时（毫秒）" :style="{ marginBottom: '8px' }">
                    <a-input-number
                      v-model="form.capBrowserTimeout"
                      :min="5000"
                      :max="300000"
                      :step="5000"
                      size="small"
                      style="width: 100%"
                    />
                  </a-form-item>
                </a-col>
              </a-row>
              <a-form-item label="截图目录（可选）" :style="{ marginBottom: '8px' }">
                <a-input
                  v-model="form.capBrowserScreenshotDir"
                  placeholder="留空则使用默认目录"
                  size="small"
                />
              </a-form-item>
              <a-form-item label="允许访问的 URL（每行一个，留空不限制）" :style="{ marginBottom: '0' }">
                <a-textarea
                  v-model="form.capBrowserAllowedUrls"
                  placeholder="http://localhost:3000&#10;https://example.com"
                  :auto-size="{ minRows: 2, maxRows: 5 }"
                  size="small"
                />
              </a-form-item>
            </div>
          </div>
        </div>
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
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useWorkersStore } from '@/stores/workers';
import { useModelsStore } from '@/stores/models';
import { useChatStore } from '@/stores/chat';
import { useSkillsStore } from '@/stores/skills';
import { Modal, Message } from '@arco-design/web-vue';
import type { MockWorker } from '@/stores/workers';
import { workspaceApi, tasksApi, type WorkspaceInfo, type WorkerTask } from '@/api/client';

const { t } = useI18n();
const router = useRouter();
const workersStore = useWorkersStore();
const modelsStore = useModelsStore();
const chatStore = useChatStore();
const skillsStore = useSkillsStore();

// ── SSE：监听 Worker 状态变更事件，实时更新在线/忙碌/下线 ──────────────────────
let workerSse: EventSource | null = null;

function startWorkerSse() {
  if (workerSse) return;
  workerSse = new EventSource('/api/events');
  workerSse.addEventListener('org', (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data) as { type: string; workerId?: string; newState?: string };
      if (event.type === 'worker:state:changed' && event.workerId && event.newState) {
        workersStore.applyStateChange(event.workerId, event.newState);
      }
    } catch { /* ignore */ }
  });
  workerSse.onerror = () => {
    stopWorkerSse();
    setTimeout(startWorkerSse, 5_000);
  };
}

function stopWorkerSse() {
  workerSse?.close();
  workerSse = null;
}

onMounted(() => {
  if (skillsStore.skills.length === 0) skillsStore.fetchSkills();
  startWorkerSse();
});

onUnmounted(() => {
  stopWorkerSse();
});

const skillOptions = computed(() => {
  const groups: Record<string, { value: string; label: string; extra: string }[]> = {
    builtin: [], user: [], project: [],
  };
  for (const s of skillsStore.skills) {
    groups[s.source]?.push({ value: s.name, label: s.name, extra: s.description });
  }
  const result: { value: string; label: string; extra: string; group?: string }[] = [];
  for (const [grp, items] of Object.entries(groups)) {
    for (const item of items) result.push({ ...item, group: grp });
  }
  return result;
});

const searchText = ref('');
const selectedId = ref<string | null>(null);
const showModal = ref(false);
const saving = ref(false);
const editingWorker = ref<MockWorker | null>(null);

// ── Detail panel state ────────────────────────────────────────────────────
const detailTab = ref('overview');
const showAvatarPicker = ref(false);
const editingWorkspacePath = ref(false);
const newWorkspacePath = ref('');
const savingWorkspace = ref(false);
const workerTasks = ref<WorkerTask[]>([]);
const tasksLoading = ref(false);

const avatarOptions = ['🤖', '🔬', '💻', '✍️', '📊', '🎯', '🚀', '💡', '🧠', '🎨', '📋', '🔭'];

const form = reactive({
  id: '',
  name: '',
  description: '',
  modelId: '',
  reviewModelId: '',
  /** 'active' = 主动轮询，'passive' = 被动唤起 */
  heartbeatMode: 'active' as 'active' | 'passive',
  /** 主动轮询间隔（秒），仅 heartbeatMode === 'active' 时生效 */
  heartbeatIntervalSec: 30,
  role: '',
  skills: [] as string[],
  tools: [] as string[],
  isPrimary: false,
  avatar: '🤖',
  workspace: '',
  // ── 能力配置 ──
  capBrowserEnabled: false,
  capBrowserHeadless: true,
  capBrowserTimeout: 30000,
  capBrowserScreenshotDir: '',
  capBrowserAllowedUrls: '',  // 换行分隔
});

const hasWorkspaceTools = computed(() =>
  form.tools.some(t => t.startsWith('workspace-'))
);

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

// 默认使用第一个模型实例 ID
const defaultModelId = computed(() => modelsStore.models[0]?.id ?? '');

function workerAvatar(worker: MockWorker) {
  return worker.avatar ?? '🤖';
}

function statusColor(status: string) {
  return { online: 'green', idle: 'orange', offline: 'gray', busy: 'arcoblue' }[status] || 'gray';
}

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 20);
}

function openCreate() {
  editingWorker.value = null;
  Object.assign(form, {
    id: '', name: '', description: '',
    modelId: defaultModelId.value, reviewModelId: '',
    heartbeatMode: 'active', heartbeatIntervalSec: 30,
    role: '', skills: [], tools: [], isPrimary: false, avatar: '🤖', workspace: '',
    capBrowserEnabled: false, capBrowserHeadless: true,
    capBrowserTimeout: 30000, capBrowserScreenshotDir: '', capBrowserAllowedUrls: '',
  });
  showModal.value = true;
}

function openEdit(worker: MockWorker) {
  editingWorker.value = worker;
  const bc = worker.capabilities?.browser;
  const bcObj = bc && typeof bc === 'object' ? bc : null;
  Object.assign(form, {
    id: worker.id,
    name: worker.name,
    description: worker.description,
    modelId: worker.modelId,
    reviewModelId: worker.reviewModelId ?? '',
    heartbeatMode: worker.heartbeatIntervalMs === 0 ? 'passive' : 'active',
    heartbeatIntervalSec: (worker.heartbeatIntervalMs && worker.heartbeatIntervalMs > 0)
      ? Math.round(worker.heartbeatIntervalMs / 1000)
      : 30,
    role: worker.role,
    skills: [...worker.skills],
    tools: [...worker.tools],
    isPrimary: worker.isPrimary,
    avatar: worker.avatar ?? '🤖',
    workspace: worker.workspace ?? '',
    capBrowserEnabled: !!bc,
    capBrowserHeadless: bcObj?.headless ?? true,
    capBrowserTimeout: bcObj?.timeout ?? 30000,
    capBrowserScreenshotDir: bcObj?.screenshotDir ?? '',
    capBrowserAllowedUrls: bcObj?.allowedUrls?.join('\n') ?? '',
  });
  showModal.value = true;
}

// slugify 仍保留供其他可能的用途
void slugify; // suppress unused warning

async function handleSave() {
  if (!form.name.trim()) {
    Message.error('请输入 Worker 名称');
    return;
  }
  if (!form.modelId) {
    Message.error('请选择模型');
    return;
  }

  const heartbeatIntervalMs = form.heartbeatMode === 'passive'
    ? 0
    : form.heartbeatIntervalSec * 1000;

  // Build capabilities
  const capabilities: import('@/api/client').WorkerCapabilities | undefined = form.capBrowserEnabled
    ? {
        browser: {
          headless: form.capBrowserHeadless,
          timeout:  form.capBrowserTimeout,
          ...(form.capBrowserScreenshotDir.trim() && { screenshotDir: form.capBrowserScreenshotDir.trim() }),
          ...(form.capBrowserAllowedUrls.trim() && {
            allowedUrls: form.capBrowserAllowedUrls.split('\n').map(u => u.trim()).filter(Boolean),
          }),
        },
      }
    : undefined;

  saving.value = true;
  try {
    if (editingWorker.value) {
      await workersStore.updateWorker(editingWorker.value.id, {
        name:               form.name.trim(),
        description:        form.description.trim(),
        avatar:             form.avatar,
        modelId:            form.modelId,
        reviewModelId:      form.reviewModelId || undefined,
        heartbeatIntervalMs,
        role:               form.role.trim(),
        skills:             form.skills,
        tools:              form.tools,
        isPrimary:          form.isPrimary,
        workspace:          form.workspace.trim() || '',
        capabilities,
      });
      Message.success('Worker 已更新');
    } else {
      await workersStore.createWorker({
        id:                 '',  // 空字符串让后端自动生成员工号
        name:               form.name.trim(),
        description:        form.description.trim(),
        avatar:             form.avatar,
        modelId:            form.modelId,
        reviewModelId:      form.reviewModelId || undefined,
        heartbeatIntervalMs,
        role:               form.role.trim(),
        skills:             form.skills,
        tools:              form.tools,
        isPrimary:          form.isPrimary,
        workspace:          form.workspace.trim() || undefined,
        capabilities,
      });
      Message.success('Worker 已创建');
    }
    showModal.value = false;
  } catch (err) {
    Message.error(err instanceof Error ? err.message : '操作失败，请重试');
  } finally {
    saving.value = false;
  }
}

function startChat(workerId: string) {
  chatStore.openWorkerChat(workerId);
  router.push('/chat');
}

// ── Workspace ──────────────────────────────────────────────────────────────
const wsInfo = ref<WorkspaceInfo | null>(null);
const wsLoading = ref(false);

async function loadWorkspace(workerId: string) {
  wsLoading.value = true;
  try {
    const res = await workspaceApi.getInfo(workerId);
    wsInfo.value = res.data;
  } catch {
    wsInfo.value = null;
  } finally {
    wsLoading.value = false;
  }
}

watch(selectedId, (id) => {
  wsInfo.value = null;
  workerTasks.value = [];
  editingWorkspacePath.value = false;
  showAvatarPicker.value = false;
  detailTab.value = 'overview';
  if (id) loadWorkspace(id);
});

// ── Detail panel helpers ─────────────────────────────────────────────────

async function pickAvatar(emoji: string) {
  if (!selectedWorker.value) return;
  showAvatarPicker.value = false;
  try {
    await workersStore.updateWorker(selectedWorker.value.id, { avatar: emoji });
  } catch {
    Message.error('头像更新失败');
  }
}

function startEditWorkspacePath(current: string) {
  newWorkspacePath.value = current;
  editingWorkspacePath.value = true;
}

function cancelEditWorkspacePath() {
  editingWorkspacePath.value = false;
  newWorkspacePath.value = '';
}

async function saveWorkspacePath(workerId: string) {
  savingWorkspace.value = true;
  try {
    await workersStore.updateWorker(workerId, { workspace: newWorkspacePath.value.trim() });
    editingWorkspacePath.value = false;
    Message.success('工作空间目录已更新');
    await loadWorkspace(workerId);
  } catch (err) {
    Message.error(err instanceof Error ? err.message : '更新失败');
  } finally {
    savingWorkspace.value = false;
  }
}

function getSkillDescription(name: string): string {
  return skillsStore.skills.find(s => s.name === name)?.description ?? '';
}

function getSkillSourceLabel(name: string): string {
  const src = skillsStore.skills.find(s => s.name === name)?.source ?? 'builtin';
  return src === 'builtin' ? '内置' : src === 'user' ? '用户' : '项目';
}

async function loadWorkerTasks(workerId: string) {
  tasksLoading.value = true;
  try {
    workerTasks.value = await tasksApi.list(workerId);
  } catch {
    workerTasks.value = [];
  } finally {
    tasksLoading.value = false;
  }
}

function onTabChange(key: string | number) {
  if (key === 'todos' && selectedWorker.value) {
    loadWorkerTasks(selectedWorker.value.id);
  }
}

function taskStatusColor(status: string): string {
  return ({ todo: 'blue', in_progress: 'orange', done: 'green', blocked: 'red', cancelled: 'gray' } as Record<string, string>)[status] ?? 'gray';
}

function taskStatusLabel(status: string): string {
  return ({ todo: '待处理', in_progress: '进行中', done: '已完成', blocked: '已阻塞', cancelled: '已取消' } as Record<string, string>)[status] ?? status;
}

function taskPriorityColor(priority: string): string {
  return ({ urgent: 'red', high: 'orange', medium: 'blue', low: 'gray' } as Record<string, string>)[priority] ?? 'gray';
}

async function deleteWorkspaceFile(workerId: string, filePath: string) {
  try {
    await workspaceApi.deleteFile(workerId, filePath);
    Message.success('文件已删除');
    await loadWorkspace(workerId);
  } catch {
    Message.error('删除失败');
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function confirmDelete(id: string) {
  const worker = workersStore.getWorker(id);
  Modal.confirm({
    title: t('workers.confirmDelete'),
    content: `确定要删除员工「${worker?.name ?? id}」吗？此操作不可撤销。`,
    async onOk() {
      try {
        await workersStore.deleteWorker(id);
        if (selectedId.value === id) selectedId.value = null;
        Message.success('Worker 已删除');
      } catch (err) {
        Message.error(err instanceof Error ? err.message : '删除失败');
      }
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
.wl-status-dot.busy { background: #165dff; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

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

/* ─── Detail (tabbed redesign) ────────────────────────────────────────── */

.worker-detail {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Profile header */
.detail-profile {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 0;
  position: relative;
}

.detail-avatar-wrap {
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-avatar {
  font-size: 52px;
  line-height: 1;
}

.avatar-hover-hint {
  position: absolute;
  bottom: 0;
  right: 0;
  background: rgba(22, 93, 255, 0.85);
  color: #fff;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.detail-avatar-wrap:hover .avatar-hover-hint {
  opacity: 1;
}

.avatar-picker-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 200px;
}

.avatar-picker-opt {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  border: 2px solid transparent;
  background: var(--bg-base);
  transition: all 0.12s;
}

.avatar-picker-opt:hover { border-color: #165dff; }
.avatar-picker-opt.selected { border-color: #165dff; background: rgba(22, 93, 255, 0.1); }

.detail-meta {
  flex: 1;
  min-width: 0;
}

.detail-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.detail-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.detail-id {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
  margin-bottom: 4px;
}

.detail-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.detail-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  align-items: flex-start;
}

/* Tabs */
.detail-tabs {
  flex: 1;
}

.tab-body {
  padding: 16px 0 0;
  min-height: 200px;
}

.tab-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Info sections (overview tab) */
.info-section {
  margin-bottom: 20px;
}

.info-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.info-label {
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 64px;
}

/* Skill cards */
.skill-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.skill-card {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
}

.skill-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}

.skill-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.skill-card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Tools list */
.tools-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  transition: background 0.12s;
}

.tool-row.tool-enabled {
  border-color: rgba(0, 180, 42, 0.2);
  background: rgba(0, 180, 42, 0.03);
}

.tool-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-color);
  flex-shrink: 0;
}

.tool-dot.enabled { background: #00b42a; }

.tool-row-info {
  flex: 1;
  min-width: 0;
}

.tool-row-label {
  display: block;
  font-size: 13px;
  color: var(--text-primary);
}

.tool-row-id {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
}

/* Workspace path row */
.ws-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.ws-path-code {
  flex: 1;
  font-size: 12px;
  font-family: monospace;
  color: var(--text-primary);
  background: var(--bg-base);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  word-break: break-all;
}

.workspace-refresh-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

/* Task list */
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-base);
}

.task-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.task-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.task-item-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.task-item-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 6px;
}

.task-item-meta {
  font-size: 11px;
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

/* ─── Workspace Files ──────────────────────────────────────────────────── */

.workspace-section {
  margin-bottom: 24px;
}

.workspace-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.workspace-header h3 {
  margin-bottom: 0;
  flex: 1;
}

.ws-loading {
  text-align: center;
  padding: 16px;
}

.ws-dir-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.ws-dir-label code {
  font-size: 11px;
  background: var(--bg-base);
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  word-break: break-all;
}

.ws-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 12px;
  background: var(--bg-base);
  border-radius: 8px;
  text-align: center;
}

.ws-file-list {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.ws-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
  transition: background 0.12s;
}

.ws-file-item:last-child {
  border-bottom: none;
}

.ws-file-item:hover {
  background: rgba(22, 93, 255, 0.03);
}

.ws-file-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.ws-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-family: monospace;
  font-size: 12px;
}

.ws-file-size {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  width: 56px;
  text-align: right;
}

.ws-file-date {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  width: 120px;
  text-align: right;
}

.ws-file-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.ws-download-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 15px;
  text-decoration: none;
  transition: all 0.15s;
}

.ws-download-btn:hover {
  color: #165dff;
  background: rgba(22, 93, 255, 0.08);
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

/* ─── Capabilities display ──────────────────────────────────────────── */

.cap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cap-item {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.02);
}

.dark .cap-item {
  background: rgba(255, 255, 255, 0.02);
}

.cap-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.cap-icon { font-size: 16px; }

.cap-name {
  flex: 1;
  color: var(--color-text-1);
}

.cap-config {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
}

.cap-config code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.dark .cap-config code {
  background: rgba(255, 255, 255, 0.08);
}

.cap-allowed-urls {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-3);
}

.url-chip {
  display: inline-block;
  background: rgba(22, 93, 255, 0.08);
  color: #165dff;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  margin-left: 4px;
}

/* ─── Capabilities form ──────────────────────────────────────────────── */

.cap-form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cap-form-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.cap-form-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.02);
  cursor: default;
}

.dark .cap-form-header {
  background: rgba(255, 255, 255, 0.02);
}

.cap-form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
}

.cap-form-body {
  padding: 12px 14px 8px;
  border-top: 1px solid var(--border-color);
}
</style>
