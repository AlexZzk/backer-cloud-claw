<template>
  <!-- Gather 风格 2D 场景地图 -->
  <div class="scene-map-wrap" ref="wrapRef">
    <svg
      :viewBox="`0 0 ${svgW} ${svgH}`"
      :width="svgW"
      :height="svgH"
      class="scene-map-svg"
    >
      <!-- 背景 -->
      <rect width="100%" height="100%" :fill="bgColor" rx="12" />

      <!-- 网格线（细格辅助线） -->
      <g class="grid-lines" opacity="0.08">
        <line
          v-for="c in layout.cols + 1"
          :key="`col-${c}`"
          :x1="(c - 1) * TILE"
          :y1="0"
          :x2="(c - 1) * TILE"
          :y2="svgH"
          stroke="white"
          stroke-width="0.5"
        />
        <line
          v-for="r in layout.rows + 1"
          :key="`row-${r}`"
          :x1="0"
          :y1="(r - 1) * TILE"
          :x2="svgW"
          :y2="(r - 1) * TILE"
          stroke="white"
          stroke-width="0.5"
        />
      </g>

      <!-- 区域背景 -->
      <g v-for="zr in layout.zoneRects" :key="`zone-bg-${zr.zoneId}`">
        <rect
          :x="zr.col * TILE + 2"
          :y="zr.row * TILE + 2"
          :width="zr.width * TILE - 4"
          :height="zr.height * TILE - 4"
          :fill="zoneColor(zr.zoneId)"
          :stroke="zoneBorder(zr.zoneId)"
          stroke-width="1.5"
          rx="6"
          opacity="0.85"
        />
        <!-- 区域标签 -->
        <text
          :x="zr.col * TILE + 10"
          :y="zr.row * TILE + 18"
          font-size="11"
          font-weight="600"
          :fill="zoneLabel(zr.zoneId)"
          font-family="system-ui, sans-serif"
          opacity="0.8"
        >{{ zoneName(zr.zoneId) }}</text>

        <!-- 装饰物 -->
        <text
          v-for="(deco, di) in zr.decorations ?? []"
          :key="`deco-${zr.zoneId}-${di}`"
          :x="(zr.col + deco.col) * TILE + TILE / 2"
          :y="(zr.row + deco.row) * TILE + TILE / 2 + 5"
          font-size="14"
          text-anchor="middle"
          opacity="0.55"
        >{{ DECO_EMOJI[deco.type] ?? '📦' }}</text>
      </g>

      <!-- Worker 头像 -->
      <g v-for="entity in entities" :key="`entity-${entity.entityId}`">
        <!-- 光晕（在线状态） -->
        <circle
          v-if="entity.presenceState !== 'offline'"
          :cx="entityPos(entity).x"
          :cy="entityPos(entity).y"
          :r="AVATAR_R + 4"
          :fill="stateGlow(entity.presenceState)"
          opacity="0.25"
        />
        <!-- 头像圆背景 -->
        <circle
          :cx="entityPos(entity).x"
          :cy="entityPos(entity).y"
          :r="AVATAR_R"
          :fill="stateFill(entity.presenceState)"
          :stroke="stateBorder(entity.presenceState)"
          stroke-width="2"
        />
        <!-- 头像文字（emoji / 首字母） -->
        <text
          :x="entityPos(entity).x"
          :y="entityPos(entity).y + 5"
          font-size="14"
          text-anchor="middle"
          font-family="system-ui, sans-serif"
        >{{ workerEmoji(entity.workerId) }}</text>
        <!-- 名字标签 -->
        <text
          :x="entityPos(entity).x"
          :y="entityPos(entity).y + AVATAR_R + 13"
          font-size="9"
          text-anchor="middle"
          :fill="entity.presenceState === 'offline' ? '#888' : '#fff'"
          font-family="system-ui, sans-serif"
          font-weight="500"
        >{{ shortName(entity.displayName) }}</text>
        <!-- 状态点 -->
        <circle
          :cx="entityPos(entity).x + AVATAR_R - 3"
          :cy="entityPos(entity).y - AVATAR_R + 3"
          r="4"
          :fill="stateDot(entity.presenceState)"
          stroke="#1a1a2e"
          stroke-width="1.5"
        />
      </g>

      <!-- 空状态提示 -->
      <text
        v-if="entities.length === 0"
        :x="svgW / 2"
        :y="svgH / 2"
        text-anchor="middle"
        font-size="14"
        fill="rgba(255,255,255,0.3)"
        font-family="system-ui, sans-serif"
      >No workers in this scene</text>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScenePresenceSnapshot, SceneEntity, PresenceState } from '@/api/client'
import type { SceneLayout, ZoneRect } from '@/api/sceneLayout'

const props = defineProps<{
  layout: SceneLayout
  snapshot: ScenePresenceSnapshot
  /** workerId → avatar emoji，来自 workers 列表 */
  workerAvatars?: Map<string, string>
  /** zoneId → zone name，来自 scene definition */
  zoneNames?: Map<string, string>
}>()

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** 每格像素大小 */
const TILE = 40
/** worker 头像半径 */
const AVATAR_R = 14

const DECO_EMOJI: Record<string, string> = {
  desk:          '🖥️',
  meeting_table: '📋',
  sofa:          '🛋️',
  plant:         '🌿',
  coffee:        '☕',
  monitor:       '💻',
  game_station:  '🎮',
}

// ─── 尺寸 ─────────────────────────────────────────────────────────────────────

const svgW = computed(() => props.layout.cols * TILE)
const svgH = computed(() => props.layout.rows * TILE)

const bgColor = computed(() =>
  props.layout.theme === 'game_studio' ? '#1a1a2e' : '#1e2a3a'
)

// ─── 区域工具函数 ─────────────────────────────────────────────────────────────

const ZONE_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  work:    { bg: '#162032', border: '#2d5a8e', label: '#7ab3e0' },
  meeting: { bg: '#1e1a2e', border: '#6b3fb5', label: '#b08ee0' },
  social:  { bg: '#1a2820', border: '#2d7a4f', label: '#6ed4a0' },
  system:  { bg: '#1a1a1a', border: '#444', label: '#777' },
  private: { bg: '#2e1a20', border: '#8e3d4f', label: '#d08080' },
}

function getZone(zoneId: string): ZoneRect | undefined {
  return props.layout.zoneRects.find(z => z.zoneId === zoneId)
}

function getZoneType(zoneId: string): string {
  // 由父组件通过 zoneNames 传入 type，这里用 id 猜测（fallback）
  if (zoneId.includes('meeting') || zoneId.includes('war-room')) return 'meeting'
  if (zoneId.includes('break') || zoneId.includes('lounge') || zoneId.includes('social')) return 'social'
  if (zoneId.includes('outside') || zoneId.includes('spawn')) return 'system'
  return 'work'
}

function zoneColor(zoneId: string): string {
  return ZONE_COLORS[getZoneType(zoneId)]?.bg ?? '#1a2030'
}
function zoneBorder(zoneId: string): string {
  return ZONE_COLORS[getZoneType(zoneId)]?.border ?? '#444'
}
function zoneLabel(zoneId: string): string {
  return ZONE_COLORS[getZoneType(zoneId)]?.label ?? '#aaa'
}
function zoneName(zoneId: string): string {
  return props.zoneNames?.get(zoneId) ?? zoneId
}

// ─── Entity 位置计算 ──────────────────────────────────────────────────────────

const entities = computed(() => props.snapshot.entities)

/** 计算 entity 在 SVG 中的坐标（在所在 zone 内均匀分布） */
function entityPos(entity: SceneEntity): { x: number; y: number } {
  const zr = getZone(entity.zoneId)
  if (!zr) {
    // fallback 到地图右下角
    return { x: svgW.value - TILE, y: svgH.value - TILE }
  }

  // 找出同一 zone 内所有 entity，计算当前 entity 的序号
  const sameZone = entities.value.filter(e => e.zoneId === entity.zoneId)
  const idx = sameZone.findIndex(e => e.entityId === entity.entityId)
  const total = sameZone.length

  // 在 zone 内部均匀排列（留出边距，避开装饰物区域）
  const margin = TILE * 1.2
  const innerW = zr.width  * TILE - margin * 2
  const innerH = zr.height * TILE - margin * 2 - TILE * 0.5 // 顶部让给标签

  const cols = Math.max(1, Math.floor(innerW / (AVATAR_R * 3)))
  const col  = idx % cols
  const row  = Math.floor(idx / cols)

  const cellW = innerW / Math.min(total, cols)
  const cellH = AVATAR_R * 3

  const x = zr.col * TILE + margin + col * cellW + cellW / 2
  const y = zr.row * TILE + margin + TILE * 0.5 + row * cellH + AVATAR_R

  return { x, y }
}

// ─── 状态颜色 ─────────────────────────────────────────────────────────────────

const STATE_FILL: Record<PresenceState, string> = {
  working: '#1a472a',
  idle:    '#1a2a4a',
  meeting: '#2e1a4a',
  focus:   '#3a2a0a',
  offline: '#1a1a1a',
}
const STATE_BORDER: Record<PresenceState, string> = {
  working: '#00b42a',
  idle:    '#4080ff',
  meeting: '#722ed1',
  focus:   '#ff7d00',
  offline: '#555',
}
const STATE_GLOW: Record<PresenceState, string> = {
  working: '#00b42a',
  idle:    '#4080ff',
  meeting: '#722ed1',
  focus:   '#ff7d00',
  offline: 'transparent',
}
const STATE_DOT: Record<PresenceState, string> = {
  working: '#00d633',
  idle:    '#60a0ff',
  meeting: '#a060ff',
  focus:   '#ffaa00',
  offline: '#555',
}

function stateFill(s: PresenceState): string  { return STATE_FILL[s]   ?? '#1a1a1a' }
function stateBorder(s: PresenceState): string { return STATE_BORDER[s] ?? '#555'    }
function stateGlow(s: PresenceState): string   { return STATE_GLOW[s]   ?? '#000'    }
function stateDot(s: PresenceState): string    { return STATE_DOT[s]    ?? '#555'    }

// ─── Worker 展示 ─────────────────────────────────────────────────────────────

function workerEmoji(workerId: string): string {
  return props.workerAvatars?.get(workerId) ?? '🤖'
}

function shortName(name: string): string {
  return name.length > 8 ? name.slice(0, 7) + '…' : name
}
</script>

<style scoped>
.scene-map-wrap {
  overflow: auto;
  border-radius: 12px;
  background: #1e2a3a;
  padding: 8px;
  width: 100%;
}
.scene-map-svg {
  display: block;
  max-width: 100%;
}
</style>
