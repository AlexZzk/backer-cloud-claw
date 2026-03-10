<template>
  <div class="chat-view">
    <!-- Sub panel: conversation list -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.chat') }}</span>
        <a-button type="primary" size="mini" shape="circle" @click="showWorkerPicker = true">
          <template #icon><icon-plus /></template>
        </a-button>
      </div>

      <div class="sub-search">
        <a-input
          v-model="searchText"
          :placeholder="t('common.search')"
          size="small"
          allow-clear
        >
          <template #prefix><icon-search /></template>
        </a-input>
      </div>

      <div class="conv-list">
        <div
          v-for="conv in filteredConvs"
          :key="conv.id"
          class="conv-item"
          :class="{ active: chatStore.activeConvId === conv.id }"
          @click="chatStore.selectConv(conv.id)"
        >
          <div class="conv-avatar">
            {{ getWorkerAvatar(conv.workerId) }}
          </div>
          <div class="conv-info">
            <div class="conv-title">{{ conv.title }}</div>
            <div class="conv-last">{{ conv.lastMessage || t('chat.startChat') }}</div>
          </div>
          <div class="conv-meta">
            <span class="conv-time">{{ formatTime(conv.updatedAt) }}</span>
            <a-button
              type="text"
              size="mini"
              class="conv-delete"
              @click.stop="chatStore.deleteConv(conv.id)"
            >
              <template #icon><icon-delete /></template>
            </a-button>
          </div>
        </div>

        <div v-if="filteredConvs.length === 0" class="empty-hint">
          <p>{{ t('chat.noConversations') }}</p>
          <a-button type="primary" size="small" @click="showWorkerPicker = true">
            {{ t('chat.newChat') }}
          </a-button>
        </div>
      </div>
    </div>

    <!-- Chat main area -->
    <div class="chat-main">
      <template v-if="chatStore.activeConv">
        <!-- Header -->
        <div class="chat-header">
          <div class="chat-header-left">
            <span class="worker-avatar">{{ getWorkerAvatar(chatStore.activeConv.workerId) }}</span>
            <div>
              <div class="worker-name">{{ chatStore.activeConv.workerName }}</div>
              <div class="worker-model">{{ getWorkerModel(chatStore.activeConv.workerId) }}</div>
            </div>
          </div>
          <div class="chat-header-actions">
            <a-tooltip :content="t('chat.clearHistory')">
              <a-button type="text" @click="handleClear">
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
          <div
            v-for="msg in chatStore.activeConv.messages"
            :key="msg.id"
            class="message-wrapper"
            :class="msg.role"
          >
            <div v-if="msg.role === 'assistant'" class="msg-avatar">
              {{ getWorkerAvatar(chatStore.activeConv!.workerId) }}
            </div>
            <div class="message-bubble" :class="msg.role">
              <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
              <div class="message-footer" v-if="msg.tokenUsage">
                <span class="token-info">
                  ↑ {{ msg.tokenUsage.inputTokens }} / ↓ {{ msg.tokenUsage.outputTokens }} tokens
                </span>
              </div>
            </div>
            <div v-if="msg.role === 'user'" class="msg-avatar user-av">
              {{ authStore.user?.avatar || '👤' }}
            </div>
          </div>

          <!-- Thinking indicator -->
          <div v-if="chatStore.isThinking" class="message-wrapper assistant">
            <div class="msg-avatar">{{ getWorkerAvatar(chatStore.activeConv.workerId) }}</div>
            <div class="message-bubble assistant thinking">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
          </div>

          <!-- Empty state -->
          <div v-if="chatStore.activeConv.messages.length === 0 && !chatStore.isThinking" class="chat-empty">
            <div class="empty-icon">{{ getWorkerAvatar(chatStore.activeConv.workerId) }}</div>
            <h3>{{ chatStore.activeConv.workerName }}</h3>
            <p>{{ getWorkerDesc(chatStore.activeConv.workerId) }}</p>
            <div class="suggestion-chips">
              <a-tag
                v-for="chip in getSuggestions(chatStore.activeConv.workerId)"
                :key="chip"
                color="arcoblue"
                class="suggestion-chip"
                @click="inputText = chip"
              >{{ chip }}</a-tag>
            </div>
          </div>
        </div>

        <!-- Input area -->
        <div class="input-area">
          <div class="input-box">
            <a-textarea
              v-model="inputText"
              :placeholder="t('chat.placeholder')"
              :auto-size="{ minRows: 1, maxRows: 5 }"
              @keydown.enter.exact.prevent="handleSend"
              @keydown.enter.shift.exact="() => {}"
              :disabled="chatStore.isThinking"
            />
            <div class="input-actions">
              <span class="char-count">{{ inputText.length }}</span>
              <a-button
                type="primary"
                :disabled="!inputText.trim() || chatStore.isThinking"
                @click="handleSend"
                class="send-btn"
              >
                <template #icon><icon-send /></template>
              </a-button>
            </div>
          </div>
        </div>
      </template>

      <!-- No conversation selected -->
      <div v-else class="no-conv">
        <div class="no-conv-icon">💬</div>
        <h2>{{ t('chat.noConversations') }}</h2>
        <p>{{ t('chat.startChat') }}</p>
        <a-button type="primary" size="large" @click="showWorkerPicker = true">
          {{ t('chat.newChat') }}
        </a-button>
      </div>
    </div>

    <!-- Worker picker modal -->
    <a-modal
      v-model:visible="showWorkerPicker"
      :title="t('chat.selectWorker')"
      :footer="false"
      width="480px"
    >
      <div class="worker-picker">
        <div
          v-for="worker in workersStore.workers"
          :key="worker.id"
          class="worker-pick-item"
          @click="startChat(worker.id)"
        >
          <span class="pick-avatar">{{ worker.avatar }}</span>
          <div class="pick-info">
            <div class="pick-name">{{ worker.name }}</div>
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
import { useChatStore } from '@/stores/chat';
import { useWorkersStore } from '@/stores/workers';
import { useAuthStore } from '@/stores/auth';
import { Message } from '@arco-design/web-vue';

const { t } = useI18n();
const chatStore = useChatStore();
const workersStore = useWorkersStore();
const authStore = useAuthStore();

const inputText = ref('');
const searchText = ref('');
const showWorkerPicker = ref(false);
const messagesArea = ref<HTMLElement>();

const filteredConvs = computed(() => {
  if (!searchText.value) return chatStore.conversations;
  const s = searchText.value.toLowerCase();
  return chatStore.conversations.filter(c =>
    c.title.toLowerCase().includes(s) || c.workerName.toLowerCase().includes(s)
  );
});

function getWorkerAvatar(workerId: string) {
  return workersStore.workers.find(w => w.id === workerId)?.avatar ?? '🤖';
}

function getWorkerModel(workerId: string) {
  return workersStore.workers.find(w => w.id === workerId)?.modelId ?? '';
}

function getWorkerDesc(workerId: string) {
  return workersStore.workers.find(w => w.id === workerId)?.description ?? '';
}

function getSuggestions(workerId: string): string[] {
  const suggestions: Record<string, string[]> = {
    'w-research': ['搜索最新的 AI 研究进展', '分析这篇论文的主要观点', '帮我整理技术资料'],
    'w-code': ['帮我优化这段代码', '解释这个错误信息', '写一个 TypeScript 工具函数'],
    'w-writer': ['写一篇产品介绍文章', '帮我优化这段文案', '翻译成英文'],
    'w-data': ['分析这组数据的趋势', '生成数据可视化方案', '计算统计指标'],
  };
  return suggestions[workerId] ?? ['你好，请问有什么可以帮你？'];
}

function statusColor(status: string) {
  return { online: 'green', idle: 'orange', offline: 'gray' }[status] || 'gray';
}

function formatTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  return new Date(ts).toLocaleDateString();
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

function handleClear() {
  chatStore.clearHistory();
  Message.success(t('common.success'));
}

function handleExport() {
  const conv = chatStore.activeConv;
  if (!conv) return;
  const text = conv.messages
    .map(m => `[${m.role === 'user' ? '用户' : conv.workerName}]\n${m.content}`)
    .join('\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title}.txt`;
  a.click();
}

function startChat(workerId: string) {
  chatStore.createConv(workerId);
  showWorkerPicker.value = false;
}

watch(() => chatStore.activeConv?.messages.length, async () => {
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
  flex-shrink: 0;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.sub-search {
  padding: 0 12px 12px;
  flex-shrink: 0;
}

.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}

.conv-item:hover { background: rgba(22, 93, 255, 0.05); }
.conv-item.active { background: rgba(22, 93, 255, 0.1); }

.conv-avatar {
  font-size: 22px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--bg-card);
  flex-shrink: 0;
}

.conv-info {
  flex: 1;
  min-width: 0;
}

.conv-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-last {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.conv-time {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.conv-delete {
  opacity: 0;
  transition: opacity 0.15s;
}

.conv-item:hover .conv-delete {
  opacity: 1;
}

.empty-hint {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
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
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.worker-avatar {
  font-size: 28px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--bg-base);
}

.worker-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.worker-model {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 1px;
}

.chat-header-actions {
  display: flex;
  gap: 4px;
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

.message-wrapper.user {
  flex-direction: row-reverse;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--bg-base);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.user-av {
  background: rgba(22, 93, 255, 0.1);
}

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

.token-info {
  font-size: 11px;
  opacity: 0.5;
}

/* Thinking animation */
.thinking {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 14px 18px;
}

.dot {
  width: 7px;
  height: 7px;
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

/* Empty state */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
  gap: 12px;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 56px;
  margin-bottom: 8px;
}

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

.suggestion-chip:hover {
  transform: translateY(-2px);
}

/* ─── Input ──────────────────────────────────────────────────────────── */

.input-area {
  padding: 16px 20px 20px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 8px 12px;
  transition: border-color 0.2s;
}

.input-box:focus-within {
  border-color: #165dff;
}

.input-box :deep(.arco-textarea) {
  background: transparent;
  border: none;
  resize: none;
  flex: 1;
}

.input-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.char-count {
  font-size: 11px;
  color: var(--text-tertiary);
}

.send-btn {
  border-radius: 10px;
}

/* ─── No Conversation ────────────────────────────────────────────────── */

.no-conv {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.no-conv-icon {
  font-size: 64px;
}

.no-conv h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
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
}

.pick-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
</style>
