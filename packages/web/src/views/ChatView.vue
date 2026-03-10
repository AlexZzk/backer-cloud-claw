<template>
  <div class="chat-view">
    <!-- Sub panel: worker contact list -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.chat') }}</span>
        <a-button type="primary" size="mini" shape="circle" @click="showWorkerPicker = true">
          <template #icon><icon-plus /></template>
        </a-button>
      </div>
      <div class="sub-search">
        <a-input v-model="searchText" :placeholder="t('common.search')" size="small" allow-clear>
          <template #prefix><icon-search /></template>
        </a-input>
      </div>

      <div class="contact-list">
        <!-- Onboarding hint when no workers -->
        <div v-if="!workersStore.loading && !hasWorkers" class="contact-empty">
          <div style="font-size: 28px; margin-bottom: 8px;">🤖</div>
          <div style="font-size: 12px; color: var(--text-secondary); text-align: center; line-height: 1.6;">
            还没有 AI 员工<br>请先在「设置」中配置模型
          </div>
          <a-button size="mini" type="primary" style="margin-top: 12px" @click="router.push('/settings')">
            去配置
          </a-button>
        </div>
        <div
          v-for="item in filteredContacts"
          :key="item.worker.id"
          class="contact-item"
          :class="{ active: chatStore.activeWorkerId === item.worker.id }"
          @click="chatStore.selectWorker(item.worker.id)"
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
      </div>
    </div>

    <!-- Chat main -->
    <div class="chat-main">
      <template v-if="chatStore.activeWorkerId && activeWorker">
        <!-- Header -->
        <div class="chat-header">
          <div class="chat-header-left">
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
          </div>
          <div class="chat-header-right">
            <a-button type="primary" size="small" @click="handleNewSession">
              <template #icon><icon-plus /></template>
              {{ t('chat.newSession') }}
            </a-button>
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

        <!-- Session tabs (shown when worker has multiple sessions) -->
        <div class="session-tabs" v-if="workerSessions.length > 0">
          <div class="sessions-scroll">
            <div
              v-for="sess in workerSessions"
              :key="sess.id"
              class="session-tab"
              :class="{ active: chatStore.activeSessionId === sess.id }"
              @click="chatStore.selectSession(sess.id)"
            >
              <span class="sess-title">{{ sess.title }}</span>
              <span class="sess-time">{{ formatTime(sess.updatedAt) }}</span>
              <span
                class="sess-close"
                @click.stop="chatStore.deleteSession(sess.id)"
                v-if="workerSessions.length > 1"
              >×</span>
            </div>
          </div>
        </div>

        <!-- Messages -->
        <div class="messages-area" ref="messagesArea">
          <!-- Empty state -->
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
              <div v-if="msg.role === 'assistant'" class="msg-avatar">
                🤖
              </div>
              <div class="message-bubble" :class="msg.role">
                <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
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

      <!-- No worker selected -->
      <div v-else class="no-conv">
        <template v-if="hasWorkers">
          <div class="no-conv-icon">💬</div>
          <h2>{{ t('chat.noConversations') }}</h2>
          <p>{{ t('chat.startChat') }}</p>
          <a-button
            v-if="primaryWorker"
            type="primary"
            size="large"
            @click="chatStore.selectWorker(primaryWorker.id)"
          >
            与「{{ primaryWorker.name }}」开始对话
          </a-button>
          <a-button v-else type="primary" size="large" @click="showWorkerPicker = true">
            {{ t('chat.selectWorker') }}
          </a-button>
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

    <!-- Worker picker modal (for starting new worker chat) -->
    <a-modal
      v-model:visible="showWorkerPicker"
      :title="t('chat.selectWorker')"
      :footer="false"
      width="480px"
    >
      <div class="worker-picker">
        <div
          v-for="worker in allWorkers"
          :key="worker.id"
          class="worker-pick-item"
          @click="startNewWorkerChat(worker.id)"
        >
          <span class="pick-avatar">🤖</span>
          <div class="pick-info">
            <div class="pick-name">
              {{ worker.name }}
              <a-tag v-if="worker.isPrimary" color="arcoblue" size="small">默认助理</a-tag>
            </div>
            <div class="pick-desc">{{ worker.description }}</div>
          </div>
          <a-tag :color="statusColor(worker.status)" size="small">
            {{ t(`workers.${worker.status}`) }}
          </a-tag>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { useWorkersStore } from '@/stores/workers';
import { useModelsStore } from '@/stores/models';

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

const allWorkers = computed(() => workersStore.workers);
const hasWorkers = computed(() => workersStore.workers.length > 0);
const hasModels = computed(() => modelsStore.models.length > 0);
const primaryWorker = computed(() =>
  workersStore.workers.find(w => w.isPrimary) ?? workersStore.workers[0] ?? null
);

const activeWorker = computed(() =>
  chatStore.activeWorkerId
    ? workersStore.getWorker(chatStore.activeWorkerId) ?? null
    : null
);

const workerSessions = computed(() =>
  chatStore.activeWorkerId
    ? chatStore.getWorkerSessions(chatStore.activeWorkerId)
    : []
);

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
  // 根据 role/name 的关键词推断建议词
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

function renderMarkdown(text: string): string {
  return text
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
}

async function handleSend() {
  if (!inputText.value.trim() || chatStore.isThinking) return;
  // If no active session, create one first
  if (!chatStore.activeSessionId && chatStore.activeWorkerId) {
    await chatStore.newSession(chatStore.activeWorkerId);
  }
  const text = inputText.value;
  inputText.value = '';
  await chatStore.sendMessage(text);
  await nextTick();
  scrollToBottom();
}

async function handleNewSession() {
  if (!chatStore.activeWorkerId) return;
  await chatStore.newSession(chatStore.activeWorkerId);
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

function startNewWorkerChat(workerId: string) {
  chatStore.selectWorker(workerId);
  showWorkerPicker.value = false;
}

watch(() => chatStore.activeSession?.messages.length, async () => {
  await nextTick();
  scrollToBottom();
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

/* ─── Session Tabs ───────────────────────────────────────────────────── */

.session-tabs {
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-subpanel);
  flex-shrink: 0;
}

.sessions-scroll {
  display: flex;
  overflow-x: auto;
  padding: 6px 16px;
  gap: 6px;
}

.sessions-scroll::-webkit-scrollbar { height: 3px; }

.session-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-card);
  transition: all 0.15s;
  flex-shrink: 0;
}

.session-tab:hover { border-color: #165dff; color: var(--text-primary); }
.session-tab.active {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.06);
  color: #165dff;
  font-weight: 500;
}

.sess-title { max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
.sess-time { font-size: 11px; opacity: 0.6; }
.sess-close {
  font-size: 14px;
  opacity: 0.5;
  margin-left: 2px;
  line-height: 1;
}
.sess-close:hover { opacity: 1; color: #f53f3f; }

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

/* ─── Worker Picker ──────────────────────────────────────────────────── */

.worker-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.worker-pick-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  cursor: pointer;
  border: 1px solid var(--border-color);
  transition: all 0.15s;
}

.worker-pick-item:hover {
  border-color: #165dff;
  background: rgba(22, 93, 255, 0.04);
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
</style>
