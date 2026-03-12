<template>
  <div class="chat-view">
    <!-- Sub panel: conversation list -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.chat') }}</span>
        <a-button type="primary" size="mini" shape="circle" @click="openNewChatPicker" title="新建对话">
          <template #icon><icon-plus /></template>
        </a-button>
      </div>
      <div class="sub-search">
        <a-input v-model="searchText" :placeholder="t('common.search')" size="small" allow-clear>
          <template #prefix><icon-search /></template>
        </a-input>
      </div>

      <div class="contact-list">
        <!-- No workers configured at all -->
        <div v-if="!workersStore.loading && !hasWorkers" class="contact-empty">
          <div style="font-size: 28px; margin-bottom: 8px;">🤖</div>
          <div style="font-size: 12px; color: var(--text-secondary); text-align: center; line-height: 1.6;">
            还没有 AI 员工<br>请先在「设置」中配置模型
          </div>
          <a-button size="mini" type="primary" style="margin-top: 12px" @click="router.push('/settings')">
            去配置
          </a-button>
        </div>

        <!-- Loading state -->
        <div v-else-if="chatStore.loading && !chatStore.sessionsLoaded" class="contact-empty">
          <a-spin size="small" />
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">加载中...</div>
        </div>

        <!-- Has workers, no conversations yet -->
        <div
          v-else-if="hasWorkers && chatStore.sessionsLoaded && filteredContacts.length === 0 && chatStore.groupSessionList.length === 0 && chatStore.dmList.length === 0 && chatStore.asyncChatList.length === 0"
          class="contact-empty"
        >
          <div style="font-size: 28px; margin-bottom: 8px;">💬</div>
          <div style="font-size: 12px; color: var(--text-secondary); text-align: center; line-height: 1.6;">
            暂无对话记录<br>点击右上角 <strong>+</strong> 开始对话
          </div>
        </div>

        <!-- 与我对话（用户↔Worker），仅显示有聊天记录的 Worker -->
        <template v-if="filteredContacts.length > 0">
          <div class="contact-section-title">与我对话</div>
          <div
            v-for="item in filteredContacts"
            :key="item.worker.id"
            class="contact-item"
            :class="{ active: chatStore.activeSessionId && chatStore.activeWorkerId === item.worker.id && activeSessionType === 'chat' }"
            @click="handleSelectWorker(item.worker.id)"
          >
            <div class="contact-avatar" :class="{ secretary: item.worker.isPrimary }">
              🤖
              <span class="status-dot" :class="item.worker.status"></span>
            </div>
            <div class="contact-info">
              <div class="contact-name-row">
                <span class="contact-name">{{ item.worker.name }}</span>
                <span v-if="item.worker.isPrimary" class="secretary-badge">主要</span>
                <span class="contact-time">{{ item.updatedAt ? formatTime(item.updatedAt) : '' }}</span>
              </div>
              <div class="contact-last">
                {{ item.lastMessage || t('chat.startChat') }}
              </div>
            </div>
          </div>
        </template>

        <!-- 群聊（用户↔多 Worker） -->
        <template v-if="chatStore.groupSessionList.length > 0">
          <div class="contact-section-title">群聊</div>
          <div
            v-for="gs in chatStore.groupSessionList"
            :key="gs.id"
            class="contact-item dm-item"
            :class="{ active: chatStore.activeSessionId === gs.id }"
            @click="openGroupSession(gs.id)"
          >
            <div class="dm-avatars">
              <span class="dm-av" style="font-size: 16px;">👥</span>
              <span class="dm-av">🤖</span>
            </div>
            <div class="contact-info">
              <div class="contact-name-row">
                <span class="contact-name">{{ gs.title }}</span>
                <a-tag size="small" color="orange" style="font-size: 10px; margin-left: 2px;">群聊</a-tag>
                <span class="contact-time">{{ gs.updatedAt ? formatTime(gs.updatedAt) : '' }}</span>
              </div>
              <div class="contact-last">
                {{ getGroupLastMessage(gs) }}
              </div>
            </div>
          </div>
        </template>

        <!-- 员工间对话（Worker↔Worker DM + 异步聊天） -->
        <template v-if="hasWorkers && (chatStore.dmList.length > 0 || chatStore.asyncChatList.length > 0)">
          <div class="contact-section-title dm-section">
            员工间对话
            <a-button
              size="mini"
              type="text"
              shape="circle"
              title="发起员工间对话"
              @click.stop="showDmPicker = true"
            >
              <template #icon><icon-plus /></template>
            </a-button>
          </div>

          <!-- DM 会话（Web 发起的同步对话） -->
          <div
            v-for="dm in chatStore.dmList"
            :key="dm.id"
            class="contact-item dm-item"
            :class="{ active: chatStore.activeSessionId === dm.id }"
            @click="openDmSession(dm.id)"
          >
            <div class="dm-avatars">
              <span class="dm-av">🤖</span>
              <span class="dm-av">🤖</span>
            </div>
            <div class="contact-info">
              <div class="contact-name-row">
                <span class="contact-name">{{ getDmTitle(dm) }}</span>
                <span class="contact-time">{{ dm.updatedAt ? formatTime(dm.updatedAt) : '' }}</span>
              </div>
              <div class="contact-last">
                {{ getDmLastMessage(dm) }}
              </div>
            </div>
          </div>

          <!-- 异步聊天（CLI Worker 通过 send_message 工具发起） -->
          <div
            v-for="chat in chatStore.asyncChatList"
            :key="chat.id"
            class="contact-item dm-item"
            :class="{ active: chatStore.activeAsyncChatId === chat.id }"
            @click="openAsyncChat(chat.id)"
          >
            <div class="dm-avatars">
              <span class="dm-av" :style="chat.type === 'group' ? 'font-size:11px' : ''">
                {{ chat.type === 'group' ? '👥' : '🤖' }}
              </span>
              <span class="dm-av">🤖</span>
            </div>
            <div class="contact-info">
              <div class="contact-name-row">
                <span class="contact-name">{{ getAsyncChatTitle(chat) }}</span>
                <a-tag size="small" :color="chat.type === 'group' ? 'orange' : 'purple'" style="font-size: 10px; margin-left: 2px;">
                  {{ chat.type === 'group' ? '群聊' : '异步' }}
                </a-tag>
                <span class="contact-time">{{ chat.updatedAt ? formatTime(chat.updatedAt) : '' }}</span>
              </div>
              <div class="contact-last">
                {{ chat.lastMessage ? chat.lastMessage.slice(0, 40) : '暂无消息' }}
              </div>
            </div>
          </div>
        </template>

        <!-- DM section add button when no DMs yet -->
        <div v-if="hasWorkers && chatStore.sessionsLoaded && chatStore.dmList.length === 0 && chatStore.asyncChatList.length === 0 && filteredContacts.length > 0" class="dm-empty-hint">
          <span>员工间对话：</span>
          <a-button size="mini" type="text" @click.stop="showDmPicker = true">发起 +</a-button>
        </div>
      </div>
    </div>

    <!-- Chat main -->
    <div class="chat-main">

      <!-- 异步聊天监控面板 -->
      <template v-if="chatStore.activeAsyncChatId && activeAsyncChat">
        <div class="chat-header">
          <div class="chat-header-left">
            <div class="dm-header-avatars">
              <span class="worker-avatar-lg">{{ activeAsyncChat.type === 'group' ? '👥' : '🤖' }}</span>
              <span class="worker-avatar-lg dm-avatar-2">🤖</span>
            </div>
            <div>
              <div class="worker-name-row">
                <span class="worker-name">{{ getAsyncChatTitle(activeAsyncChat) }}</span>
                <a-tag :color="activeAsyncChat.type === 'group' ? 'orange' : 'purple'" size="small">
                  {{ activeAsyncChat.type === 'group' ? '群聊' : '异步对话' }}
                </a-tag>
              </div>
              <div class="worker-model">{{ activeAsyncChat.participants.map(id => getWorkerName(id)).join(' · ') }}</div>
            </div>
          </div>
          <div class="chat-header-right">
            <a-tooltip content="刷新消息">
              <a-button type="text" @click="chatStore.selectAsyncChat(activeAsyncChat.id)">
                <template #icon><icon-refresh /></template>
              </a-button>
            </a-tooltip>
          </div>
        </div>

        <div class="messages-area" ref="messagesArea">
          <div v-if="chatStore.activeAsyncChatMessages.length === 0" class="chat-empty">
            <div class="empty-avatar">💬</div>
            <h3>{{ getAsyncChatTitle(activeAsyncChat) }}</h3>
            <p>暂无消息记录</p>
          </div>
          <template v-else>
            <!-- Group chat intro hint -->
            <div v-if="activeAsyncChat.type === 'group'" class="group-chat-notice">
              <icon-info-circle style="margin-right: 6px;" />
              这是一个由 AI Worker 发起的群聊，用于协作传递信息。@提及表示定向传达。
            </div>
            <div
              v-for="msg in chatStore.activeAsyncChatMessages"
              :key="msg.id"
              class="message-wrapper assistant"
            >
              <div class="msg-avatar" :title="getWorkerName(msg.from)">🤖</div>
              <div class="message-bubble assistant">
                <div class="dm-speaker-label">{{ getWorkerName(msg.from) }}</div>
                <div class="message-content" v-html="renderMarkdownWithMentions(msg.content)"></div>
                <div class="message-footer">
                  <span class="token-info" style="opacity: 0.5;">{{ formatTime(msg.timestamp) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="async-chat-notice">
          <icon-info-circle style="margin-right: 4px;" />
          此为员工间{{ activeAsyncChat.type === 'group' ? '群聊' : '异步对话' }}（只读监控视图），消息由 AI Worker 自主发送
        </div>
      </template>

      <template v-else-if="chatStore.activeWorkerId && activeWorker">
        <!-- Header -->
        <div class="chat-header">
          <div class="chat-header-left">
            <!-- DM session header -->
            <template v-if="activeSessionType === 'dm'">
              <div class="dm-header-avatars">
                <span class="worker-avatar-lg">🤖</span>
                <span class="worker-avatar-lg dm-avatar-2">🤖</span>
              </div>
              <div>
                <div class="worker-name-row">
                  <span class="worker-name">{{ activeWorker.name }}</span>
                  <span style="color: var(--text-tertiary); font-size: 14px;">↔</span>
                  <span class="worker-name">{{ activeDmToWorker?.name ?? '?' }}</span>
                </div>
                <div class="worker-model">员工间对话</div>
              </div>
            </template>
            <!-- Group session header -->
            <template v-else-if="activeSessionType === 'group' && activeGroupSession">
              <div class="dm-header-avatars">
                <span class="worker-avatar-lg">👥</span>
                <span class="worker-avatar-lg dm-avatar-2">🤖</span>
              </div>
              <div>
                <div class="worker-name-row">
                  <span class="worker-name">{{ activeGroupSession.title }}</span>
                  <a-tag color="orange" size="small">群聊</a-tag>
                </div>
                <div class="worker-model">
                  {{ (activeGroupSession.workerIds ?? []).map(id => getWorkerName(id)).join(' · ') }}
                </div>
              </div>
            </template>
            <!-- Regular chat session header -->
            <template v-else>
              <span class="worker-avatar-lg">🤖</span>
              <div>
                <div class="worker-name-row">
                  <span class="worker-name">{{ activeWorker.name }}</span>
                  <a-tag v-if="activeWorker.isPrimary" color="arcoblue" size="small">默认助理</a-tag>
                  <a-tag :color="statusColor(activeWorker.status)" size="small">
                    {{ t(`workers.${activeWorker.status}`) }}
                  </a-tag>
                </div>
                <div class="worker-model">{{ activeWorker.modelId }}</div>
              </div>
            </template>
          </div>
          <div class="chat-header-right">
            <a-tooltip :content="t('chat.clearHistory')">
              <a-button type="text" @click="chatStore.clearSession()">
                <template #icon><icon-delete /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip :content="t('chat.exportHistory')">
              <a-button type="text" @click="handleExport">
                <template #icon><icon-download /></template>
              </a-button>
            </a-tooltip>
          </div>
        </div>

        <!-- Messages -->
        <div class="messages-area" ref="messagesArea">
          <!-- Empty state: no messages yet -->
          <div v-if="!chatStore.activeSession || chatStore.activeSession.messages.length === 0" class="chat-empty">
            <div class="empty-avatar">🤖</div>
            <h3>{{ activeWorker.name }}</h3>
            <p>{{ activeWorker.description }}</p>
            <div class="suggestion-chips">
              <a-tag
                v-for="chip in getSuggestions(activeWorker.id)"
                :key="chip"
                color="arcoblue"
                class="suggestion-chip"
                @click="inputText = chip"
              >{{ chip }}</a-tag>
            </div>
          </div>

          <!-- Messages -->
          <template v-else>
            <div
              v-for="msg in chatStore.activeSession.messages"
              :key="msg.id"
              class="message-wrapper"
              :class="msg.role"
            >
              <div v-if="msg.role === 'assistant'" class="msg-avatar" :title="getDmSpeakerName(msg.speakerId)">
                🤖
              </div>
              <div class="message-bubble" :class="msg.role">
                <div v-if="activeSessionType === 'dm' && msg.role === 'assistant' && msg.speakerId" class="dm-speaker-label">
                  {{ getDmSpeakerName(msg.speakerId) }}
                </div>
                <div class="message-content" v-html="renderMarkdownWithMentions(msg.content)"></div>
                <div class="message-footer" v-if="msg.tokenUsage">
                  <span class="token-info">
                    ↑{{ msg.tokenUsage.inputTokens }} ↓{{ msg.tokenUsage.outputTokens }} tokens
                  </span>
                </div>
              </div>
              <div v-if="msg.role === 'user'" class="msg-avatar user-av">
                {{ authStore.user?.avatar || '👤' }}
              </div>
            </div>
          </template>

          <!-- Thinking -->
          <div v-if="chatStore.isThinking" class="message-wrapper assistant">
            <div class="msg-avatar">🤖</div>
            <div class="message-bubble assistant thinking">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
          </div>
        </div>

        <!-- Input -->
        <div class="input-area">
          <div class="input-box" :class="{ focused: inputFocused }">
            <a-textarea
              v-model="inputText"
              :placeholder="t('chat.placeholder')"
              :auto-size="{ minRows: 1, maxRows: 5 }"
              @keydown.enter.exact.prevent="handleSend"
              @keydown.enter.shift.exact="() => {}"
              @focus="inputFocused = true"
              @blur="inputFocused = false"
              :disabled="chatStore.isThinking"
            />
            <div class="input-footer">
              <span class="input-hint">Enter 发送 · Shift+Enter 换行</span>
              <a-button
                type="primary"
                :disabled="!inputText.trim() || chatStore.isThinking"
                @click="handleSend"
                class="send-btn"
              >
                <template #icon><icon-send /></template>
                {{ t('chat.send') }}
              </a-button>
            </div>
          </div>
        </div>
      </template>

      <!-- No worker selected / Welcome screen -->
      <div v-else class="no-conv">
        <template v-if="hasWorkers">
          <div class="no-conv-icon">💬</div>
          <h2>{{ t('chat.noConversations') }}</h2>
          <p>选择一个对话，或点击 + 开始新对话</p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px;">
            <a-button
              v-if="primaryWorker"
              type="primary"
              size="large"
              @click="openNewChatPicker"
            >
              开始新对话
            </a-button>
            <a-button v-else type="primary" size="large" @click="openNewChatPicker">
              {{ t('chat.selectWorker') }}
            </a-button>
            <a-button size="large" @click="showDmPicker = true">
              发起员工间对话
            </a-button>
          </div>
        </template>

        <!-- Onboarding: no workers configured yet -->
        <template v-else>
          <div class="no-conv-icon">🚀</div>
          <h2>开始前先配置 AI 助理</h2>
          <p style="max-width: 360px; text-align: center; color: var(--text-secondary);">
            还没有配置任何 AI Worker。请先添加模型，再创建一个 AI 员工（助理）。
          </p>
          <div class="onboarding-steps">
            <div class="ob-step" :class="{ done: hasModels }">
              <span class="ob-num">{{ hasModels ? '✓' : '1' }}</span>
              <div class="ob-info">
                <div class="ob-title">配置 AI 模型</div>
                <div class="ob-desc">在设置中添加 API Key 和模型实例</div>
              </div>
              <a-button
                v-if="!hasModels"
                type="primary"
                size="small"
                @click="router.push('/settings')"
              >去设置</a-button>
            </div>
            <div class="ob-step" :class="{ done: hasWorkers }">
              <span class="ob-num">2</span>
              <div class="ob-info">
                <div class="ob-title">创建 AI 员工（助理）</div>
                <div class="ob-desc">在员工页面新建一个 Worker 并设为主助理</div>
              </div>
              <a-button
                v-if="hasModels"
                type="primary"
                size="small"
                @click="router.push('/workers')"
              >去创建</a-button>
              <a-button v-else size="small" disabled>去创建</a-button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- New Chat Picker Modal: select worker(s) to start conversation -->
    <a-modal
      v-model:visible="showWorkerPicker"
      title="开始新对话"
      :footer="false"
      width="520px"
    >
      <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);">
        选择一个员工开始单独对话，或选择多个员工创建群聊
      </div>
      <div class="worker-picker">
        <div
          v-for="worker in allWorkers"
          :key="worker.id"
          class="worker-pick-item"
          :class="{ selected: pickerSelectedIds.includes(worker.id) }"
          @click="togglePickerWorker(worker.id)"
        >
          <span class="pick-avatar">🤖</span>
          <div class="pick-info">
            <div class="pick-name">
              {{ worker.name }}
              <a-tag v-if="worker.isPrimary" color="arcoblue" size="small">默认助理</a-tag>
            </div>
            <div class="pick-desc">{{ worker.description }}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a-tag :color="statusColor(worker.status)" size="small">
              {{ t(`workers.${worker.status}`) }}
            </a-tag>
            <a-checkbox :model-value="pickerSelectedIds.includes(worker.id)" @click.stop />
          </div>
        </div>
      </div>

      <!-- Action footer -->
      <div v-if="pickerSelectedIds.length > 0" class="picker-footer">
        <template v-if="pickerSelectedIds.length === 1">
          <span class="picker-hint">与「{{ allWorkers.find(w => w.id === pickerSelectedIds[0])?.name }}」开始对话</span>
          <a-button type="primary" @click="confirmNewChat">开始对话</a-button>
        </template>
        <template v-else>
          <span class="picker-hint">已选 {{ pickerSelectedIds.length }} 人 · 将创建群聊</span>
          <a-button type="primary" @click="confirmGroupChat">
            创建群聊
          </a-button>
        </template>
      </div>
    </a-modal>

    <!-- DM picker modal (for starting worker↔worker DM) -->
    <a-modal
      v-model:visible="showDmPicker"
      title="发起员工间对话"
      width="480px"
      @ok="createDmSession"
      :ok-loading="dmCreating"
      :ok-button-props="{ disabled: !dmFromWorkerId || !dmToWorkerId || dmFromWorkerId === dmToWorkerId }"
    >
      <div style="display: flex; flex-direction: column; gap: 16px; padding: 8px 0;">
        <div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">发起方员工</div>
          <a-select v-model="dmFromWorkerId" placeholder="选择发起方" style="width: 100%;">
            <a-option v-for="w in allWorkers" :key="w.id" :value="w.id">🤖 {{ w.name }}</a-option>
          </a-select>
        </div>
        <div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">接收方员工</div>
          <a-select v-model="dmToWorkerId" placeholder="选择接收方" style="width: 100%;">
            <a-option v-for="w in allWorkers" :key="w.id" :value="w.id" :disabled="w.id === dmFromWorkerId">🤖 {{ w.name }}</a-option>
          </a-select>
        </div>
        <div v-if="dmFromWorkerId && dmToWorkerId && dmFromWorkerId !== dmToWorkerId" class="dm-preview">
          <span>🤖 {{ allWorkers.find(w => w.id === dmFromWorkerId)?.name }}</span>
          <span style="color: var(--text-tertiary);">↔</span>
          <span>🤖 {{ allWorkers.find(w => w.id === dmToWorkerId)?.name }}</span>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useChatStore, type ChatSession, type ApiAsyncChat } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useWorkersStore } from '@/stores/workers';
import { useModelsStore } from '@/stores/models';
import { Message } from '@arco-design/web-vue';

const { t } = useI18n();
const router = useRouter();
const chatStore = useChatStore();
const authStore = useAuthStore();
const workersStore = useWorkersStore();
const modelsStore = useModelsStore();

const inputText = ref('');
const searchText = ref('');
const showWorkerPicker = ref(false);
const inputFocused = ref(false);
const messagesArea = ref<HTMLElement>();

// New chat picker state (multi-select)
const pickerSelectedIds = ref<string[]>([]);

const showDmPicker = ref(false);
const dmFromWorkerId = ref('');
const dmToWorkerId = ref('');
const dmCreating = ref(false);

const allWorkers = computed(() => workersStore.workers);
const hasWorkers = computed(() => workersStore.workers.length > 0);
const hasModels = computed(() => modelsStore.models.length > 0);
const primaryWorker = computed(() =>
  workersStore.workers.find(w => w.isPrimary) ?? workersStore.workers[0] ?? null
);

const activeSessionType = computed(() => chatStore.activeSession?.type ?? 'chat');

const activeAsyncChat = computed(() =>
  chatStore.activeAsyncChatId
    ? chatStore.asyncChatList.find(c => c.id === chatStore.activeAsyncChatId) ?? null
    : null
);

const activeWorker = computed(() =>
  chatStore.activeWorkerId
    ? workersStore.getWorker(chatStore.activeWorkerId) ?? null
    : null
);

const activeDmToWorker = computed(() => {
  const s = chatStore.activeSession;
  return s?.type === 'dm' && s.toWorkerId
    ? workersStore.getWorker(s.toWorkerId) ?? null
    : null;
});

const activeGroupSession = computed(() => {
  const s = chatStore.activeSession;
  return s?.type === 'group' ? s : null;
});

const filteredContacts = computed(() => {
  if (!searchText.value) return chatStore.contactList;
  const s = searchText.value.toLowerCase();
  return chatStore.contactList.filter(item =>
    item.worker.name.toLowerCase().includes(s) ||
    item.lastMessage.toLowerCase().includes(s)
  );
});

function statusColor(status: string) {
  return { online: 'green', idle: 'orange', offline: 'gray' }[status] || 'gray';
}

function formatTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getSuggestions(workerId: string): string[] {
  const worker = workersStore.getWorker(workerId);
  const role = (worker?.role ?? '').toLowerCase();
  const name = (worker?.name ?? '').toLowerCase();
  if (role.includes('代码') || role.includes('程序') || name.includes('coder') || name.includes('code')) {
    return ['帮我优化这段代码', '解释这个错误信息', '写一个工具函数'];
  }
  if (role.includes('写作') || role.includes('文案') || name.includes('writer')) {
    return ['写一篇产品介绍文章', '帮我优化这段文案', '翻译成英文'];
  }
  if (role.includes('数据') || role.includes('分析') || name.includes('data')) {
    return ['分析这组数据的趋势', '生成数据可视化方案', '计算统计指标'];
  }
  if (role.includes('研究') || role.includes('调研') || name.includes('research')) {
    return ['搜索最新的 AI 研究进展', '分析这篇文章的主要观点', '帮我整理技术资料'];
  }
  return ['你好，有什么可以帮你？', '介绍一下你自己', '我们开始工作吧'];
}

/**
 * 渲染 Markdown 并高亮 @mention（@workerName 或 @workerId）
 */
function renderMarkdownWithMentions(text: string): string {
  const rendered = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n/g, '<br>');

  // 高亮 @mention：匹配 @word 或 @word-word
  return rendered.replace(/@([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g, (match, name) => {
    // 尝试通过 id 或名称找到对应 worker，显示真实名称
    const worker = workersStore.workers.find(
      w => w.id === name || w.name === name
    );
    const displayName = worker ? worker.name : name;
    return `<span class="mention">@${displayName}</span>`;
  });
}

async function handleSend() {
  if (!inputText.value.trim() || chatStore.isThinking) return;
  // If no active session, create one first (newSession is idempotent via backend)
  if (!chatStore.activeSessionId && chatStore.activeWorkerId) {
    // Prefer existing chat session before creating a new one
    const existingSession = chatStore.getWorkerSessions(chatStore.activeWorkerId)
      .find(s => s.type === 'chat');
    if (existingSession) {
      chatStore.selectSession(existingSession.id);
    } else {
      await chatStore.newSession(chatStore.activeWorkerId);
    }
  }
  const text = inputText.value;
  inputText.value = '';
  await chatStore.sendMessage(text);
  await nextTick();
  scrollToBottom();
}

function scrollToBottom() {
  if (messagesArea.value) {
    messagesArea.value.scrollTop = messagesArea.value.scrollHeight;
  }
}

function handleExport() {
  const session = chatStore.activeSession;
  const worker = activeWorker.value;
  if (!session || !worker) return;
  const text = session.messages
    .map(m => `[${m.role === 'user' ? '我' : worker.name}]\n${m.content}`)
    .join('\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${worker.name}-${session.title}.txt`;
  a.click();
}

// ─── New chat picker ─────────────────────────────────────────────────────────

function openNewChatPicker() {
  pickerSelectedIds.value = [];
  showWorkerPicker.value = true;
}

function togglePickerWorker(workerId: string) {
  const idx = pickerSelectedIds.value.indexOf(workerId);
  if (idx >= 0) {
    pickerSelectedIds.value.splice(idx, 1);
  } else {
    pickerSelectedIds.value.push(workerId);
  }
}

async function confirmNewChat() {
  if (pickerSelectedIds.value.length !== 1) return;
  const workerId = pickerSelectedIds.value[0]!;
  showWorkerPicker.value = false;
  pickerSelectedIds.value = [];
  await chatStore.selectWorker(workerId);
}

async function confirmGroupChat() {
  if (pickerSelectedIds.value.length < 2) return;
  const workerIds = [...pickerSelectedIds.value];
  showWorkerPicker.value = false;
  pickerSelectedIds.value = [];
  try {
    await chatStore.newGroupSession(workerIds);
  } catch (e) {
    Message.error('创建群聊失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

async function handleSelectWorker(workerId: string) {
  await chatStore.selectWorker(workerId);
}

function openDmSession(id: string) {
  chatStore.selectSession(id);
}

function getDmTitle(dm: ChatSession): string {
  const from = workersStore.getWorker(dm.workerId);
  const to = dm.toWorkerId ? workersStore.getWorker(dm.toWorkerId) : null;
  return `${from?.name ?? dm.workerId} ↔ ${to?.name ?? dm.toWorkerId ?? '?'}`;
}

function getDmLastMessage(dm: ChatSession): string {
  const last = dm.messages[dm.messages.length - 1];
  if (!last) return '点击查看对话';
  return last.content.slice(0, 40) || '...';
}

function getDmSpeakerName(speakerId: string | undefined): string {
  if (!speakerId) return '员工';
  return workersStore.getWorker(speakerId)?.name ?? speakerId;
}

async function createDmSession() {
  if (!dmFromWorkerId.value || !dmToWorkerId.value || dmFromWorkerId.value === dmToWorkerId.value) return;
  dmCreating.value = true;
  try {
    await chatStore.newDmSession(dmFromWorkerId.value, dmToWorkerId.value);
    showDmPicker.value = false;
    dmFromWorkerId.value = '';
    dmToWorkerId.value = '';
  } finally {
    dmCreating.value = false;
  }
}

function openGroupSession(sessionId: string) {
  chatStore.selectSession(sessionId);
  // 为 header 显示设置 activeWorkerId（群聊的第一个 worker）
  const session = chatStore.sessions.find(s => s.id === sessionId);
  if (session?.workerIds?.[0]) {
    // activeWorkerId is set by selectSession only for worker context; for group, set it here
  }
}

function getGroupLastMessage(gs: ChatSession): string {
  const last = gs.messages[gs.messages.length - 1];
  if (!last) return gs.messageCount > 0 ? '点击查看消息' : '暂无消息';
  const speaker = last.speakerId ? getWorkerName(last.speakerId) : '我';
  return `${speaker}: ${last.content.slice(0, 30)}`;
}

function openAsyncChat(chatId: string) {
  void chatStore.selectAsyncChat(chatId);
}

function getAsyncChatTitle(chat: ApiAsyncChat): string {
  if (chat.title) return chat.title;
  return chat.participants
    .map(id => workersStore.getWorker(id)?.name ?? id)
    .join(' · ');
}

function getWorkerName(id: string): string {
  return workersStore.getWorker(id)?.name ?? id;
}

watch(() => chatStore.activeSession?.messages.length, async () => {
  await nextTick();
  scrollToBottom();
});

onMounted(async () => {
  // 加载 Workers（如果尚未加载）
  if (workersStore.workers.length === 0) {
    await workersStore.fetchWorkers();
  }
  // 并行加载：历史会话列表 + 异步聊天列表
  await Promise.all([
    chatStore.fetchAllSessions(),
    chatStore.fetchAsyncChats(),
  ]);
});
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* ─── Sub Panel: Contact List ────────────────────────────────────────── */

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
  flex-shrink: 0;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.sub-search {
  padding: 0 12px 10px;
  flex-shrink: 0;
}

.contact-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}

.contact-item:hover { background: rgba(22, 93, 255, 0.05); }
.contact-item.active { background: rgba(22, 93, 255, 0.1); }

.contact-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
  position: relative;
  border: 1px solid var(--border-color);
}

.contact-avatar.secretary {
  background: linear-gradient(135deg, rgba(22, 93, 255, 0.08), rgba(114, 46, 209, 0.08));
  border-color: rgba(22, 93, 255, 0.3);
}

.status-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--bg-subpanel);
}
.status-dot.online  { background: #00b42a; }
.status-dot.idle    { background: #ff7d00; }
.status-dot.offline { background: #86909c; }

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
}

.contact-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  flex-shrink: 0;
}

.secretary-badge {
  font-size: 10px;
  background: rgba(22, 93, 255, 0.1);
  color: #165dff;
  border-radius: 4px;
  padding: 1px 5px;
  flex-shrink: 0;
}

.contact-time {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
  flex-shrink: 0;
}

.contact-last {
  font-size: 12px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Chat Main ──────────────────────────────────────────────────────── */

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-card);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.worker-avatar-lg {
  font-size: 26px;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--bg-base);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
}

.worker-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.worker-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.worker-model {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
}

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ─── Messages ───────────────────────────────────────────────────────── */

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.message-wrapper.user { flex-direction: row-reverse; }

.msg-avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--bg-base);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
}

.user-av { background: rgba(22, 93, 255, 0.08); border-color: rgba(22, 93, 255, 0.2); }

.message-bubble {
  max-width: 65%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
}

.message-bubble.assistant {
  background: var(--bg-base);
  border-radius: 4px 14px 14px 14px;
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.message-bubble.user {
  background: #165dff;
  border-radius: 14px 4px 14px 14px;
  color: #fff;
}

.message-footer {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.token-info { font-size: 11px; opacity: 0.5; }

.thinking {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 14px 18px;
}

.dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: bounce 1.2s infinite;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}

/* ─── @Mention ───────────────────────────────────────────────────────── */

:deep(.mention) {
  display: inline-block;
  background: rgba(22, 93, 255, 0.12);
  color: #165dff;
  border-radius: 4px;
  padding: 1px 5px;
  font-weight: 500;
  font-size: 0.92em;
}

/* ─── Group Chat Notice ──────────────────────────────────────────────── */

.group-chat-notice {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  background: rgba(255, 125, 0, 0.06);
  border: 1px solid rgba(255, 125, 0, 0.2);
  border-radius: 8px;
  font-size: 12px;
  color: #ff7d00;
  margin-bottom: 8px;
}

/* ─── Empty State ────────────────────────────────────────────────────── */

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 40px;
  gap: 12px;
  color: var(--text-secondary);
}

.empty-avatar { font-size: 60px; margin-bottom: 8px; }

.chat-empty h3 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.suggestion-chip {
  cursor: pointer;
  transition: all 0.15s;
}
.suggestion-chip:hover { transform: translateY(-2px); }

/* ─── Input ──────────────────────────────────────────────────────────── */

.input-area {
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.input-box {
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 10px 14px 10px;
  transition: border-color 0.2s;
}

.input-box.focused { border-color: #165dff; }

.input-box :deep(.arco-textarea) {
  background: transparent;
  border: none;
  resize: none;
  padding: 0;
  font-size: 14px;
}

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.input-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.send-btn { border-radius: 8px; }

/* ─── No Conv ────────────────────────────────────────────────────────── */

.no-conv {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.no-conv-icon { font-size: 64px; }

.no-conv h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

/* Onboarding steps */
.onboarding-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 380px;
  margin-top: 8px;
}

.ob-step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1.5px solid var(--border-color);
  background: var(--bg-base);
}

.ob-step.done {
  border-color: #00b42a;
  background: rgba(0, 180, 42, 0.04);
}

.ob-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(22, 93, 255, 0.1);
  color: #165dff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ob-step.done .ob-num {
  background: rgba(0, 180, 42, 0.12);
  color: #00b42a;
}

.ob-info { flex: 1; }

.ob-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.ob-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Contact list empty state */
.contact-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
}

/* ─── Worker Picker (multi-select) ───────────────────────────────────── */

.worker-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
}

.worker-pick-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  border: 1.5px solid var(--border-color);
  transition: all 0.15s;
}

.worker-pick-item:hover {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.04);
}

.worker-pick-item.selected {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.06);
}

.pick-avatar { font-size: 28px; }
.pick-info { flex: 1; }
.pick-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.pick-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.picker-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ─── Contact Section Title ──────────────────────────────────────────── */

.contact-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 10px 10px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dm-section { margin-top: 4px; }

/* ─── DM Contact Items ───────────────────────────────────────────────── */

.dm-item .dm-avatars {
  width: 40px;
  height: 40px;
  position: relative;
  flex-shrink: 0;
}

.dm-av {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 26px;
  text-align: center;
}

.dm-av:first-child { top: 0; left: 0; }
.dm-av:last-child  { bottom: 0; right: 0; }

.dm-empty-hint {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ─── DM Header ──────────────────────────────────────────────────────── */

.dm-header-avatars {
  display: flex;
  position: relative;
  width: 56px;
  height: 42px;
  flex-shrink: 0;
}

.dm-avatar-2 {
  position: absolute;
  right: 0;
  bottom: 0;
  font-size: 20px;
  width: 32px;
  height: 32px;
}

/* ─── DM Speaker Label ───────────────────────────────────────────────── */

.dm-speaker-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

/* ─── DM Picker Preview ──────────────────────────────────────────────── */

.dm-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  padding: 10px 16px;
  background: var(--bg-base);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

/* ─── Async Chat Notice ──────────────────────────────────────────────── */

.async-chat-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  background: rgba(114, 46, 209, 0.05);
  border-top: 1px solid rgba(114, 46, 209, 0.15);
  font-size: 12px;
  color: #722ed1;
  flex-shrink: 0;
}
</style>
