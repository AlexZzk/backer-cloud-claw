<template>
  <div class="org-tree-node">
    <!-- Row -->
    <div
      class="node-row"
      :class="{ active: selectedId === node.id }"
      :style="{ paddingLeft: `${depth * 14 + 10}px` }"
      @click="emit('select', node.id)"
    >
      <!-- Expand/collapse toggle -->
      <span
        class="expand-icon"
        @click.stop="toggleExpand"
      >
        <template v-if="node.children.length > 0">
          {{ expanded ? '▾' : '▸' }}
        </template>
        <template v-else>
          <span style="display:inline-block;width:10px"></span>
        </template>
      </span>

      <!-- Node icon + name -->
      <span class="node-icon">{{ nodeTypeIcon(node.type) }}</span>
      <span class="node-name">{{ node.name }}</span>
      <span class="node-meta">{{ memberCount }}</span>

      <!-- Add child button (hover) -->
      <a-button
        class="node-add-btn"
        type="text"
        size="mini"
        @click.stop="emit('add-child', node.id)"
      >
        <template #icon><icon-plus /></template>
      </a-button>
    </div>

    <!-- Recursive children -->
    <transition name="tree-slide">
      <div v-if="expanded && node.children.length > 0" class="node-children">
        <OrgTreeNode
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
          :selected-id="selectedId"
          @select="emit('select', $event)"
          @add-child="emit('add-child', $event)"
        />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { OrgNode } from '@/stores/org';
import { nodeTypeIcon, totalMembers } from '@/stores/org';

const props = defineProps<{
  node: OrgNode;
  depth: number;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'add-child', parentId: string): void;
}>();

// Auto-expand the root node
const expanded = ref(props.depth === 0);
const memberCount = totalMembers(props.node);

function toggleExpand() {
  if (props.node.children.length > 0) expanded.value = !expanded.value;
}
</script>

<style scoped>
.org-tree-node { font-size: 13px; }

.node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
  color: var(--text-secondary);
  position: relative;
}

.node-row:hover { background: rgba(22,93,255,0.05); color: var(--text-primary); }
.node-row.active { background: rgba(22,93,255,0.1); color: #165dff; font-weight: 500; }

.expand-icon {
  font-size: 11px;
  width: 12px;
  text-align: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.node-icon { font-size: 15px; flex-shrink: 0; }

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.node-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.node-add-btn {
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}
.node-row:hover .node-add-btn { opacity: 1; }

.node-children { margin-left: 0; }

.tree-slide-enter-active { transition: all 0.18s ease; overflow: hidden; }
.tree-slide-leave-active { transition: all 0.12s ease; overflow: hidden; }
.tree-slide-enter-from,
.tree-slide-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
