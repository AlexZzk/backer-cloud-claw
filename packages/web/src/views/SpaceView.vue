<template>
  <div class="space-root" @wheel.prevent="onWheel" @mousedown="onPanStart" @mousemove="onPanMove" @mouseup="onPanEnd" @mouseleave="onPanEnd">

    <!-- ── 顶栏 ── -->
    <div class="space-topbar">
      <div class="topbar-left">
        <span class="scene-title">{{ mapDef?.name ?? '…' }}</span>
        <span class="scene-version">{{ mapDef?.version }}</span>
      </div>
      <div class="topbar-center">
        <div class="stats-row">
          <span class="stat working">⚡ {{ stats.working }} working</span>
          <span class="stat meeting">💬 {{ stats.meeting }} meeting</span>
          <span class="stat idle">☕ {{ stats.idle }} idle</span>
          <span class="stat focus">🎧 {{ stats.focus }} focus</span>
          <span class="stat offline">💤 {{ stats.offline }} offline</span>
        </div>
      </div>
      <div class="topbar-right">
        <a-select v-model="sceneId" size="small" style="min-width:160px;margin-right:8px" @change="loadScene">
          <a-option v-for="s in sceneList" :key="s.id" :value="s.id">{{ s.name }}</a-option>
        </a-select>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <a-button size="mini" @click="resetView">⌂</a-button>
      </div>
    </div>

    <!-- ── 地图容器 ── -->
    <div class="map-viewport" ref="viewportRef">
      <div
        class="map-canvas"
        :style="{
          width:     `${mapW}px`,
          height:    `${mapH}px`,
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <!-- ① 地板 & 区域背景（SVG 静态层） -->
        <svg
          :width="mapW"
          :height="mapH"
          class="map-svg"
          style="position:absolute;top:0;left:0;"
        >
          <!-- 全局背景 -->
          <rect width="100%" height="100%" :fill="THEME.bg" />

          <!-- 区域填充 -->
          <g v-for="zone in zones" :key="`zone-${zone.id}`">
            <rect
              :x="zone.rect.col * TILE + 1"
              :y="zone.rect.row * TILE + 1"
              :width="zone.rect.width * TILE - 2"
              :height="zone.rect.height * TILE - 2"
              :fill="THEME.zone[zone.colorTheme].bg"
              rx="4"
            />
            <!-- 私密区域用虚线边框 -->
            <rect
              v-if="zone.isPrivate"
              :x="zone.rect.col * TILE + 1"
              :y="zone.rect.row * TILE + 1"
              :width="zone.rect.width * TILE - 2"
              :height="zone.rect.height * TILE - 2"
              fill="none"
              :stroke="THEME.zone[zone.colorTheme].border"
              stroke-width="2"
              stroke-dasharray="6 3"
              rx="4"
            />
            <!-- 普通区域实线边框 -->
            <rect
              v-else
              :x="zone.rect.col * TILE + 1"
              :y="zone.rect.row * TILE + 1"
              :width="zone.rect.width * TILE - 2"
              :height="zone.rect.height * TILE - 2"
              fill="none"
              :stroke="THEME.zone[zone.colorTheme].border"
              stroke-width="1.5"
              rx="4"
            />
            <!-- 区域标签 -->
            <text
              :x="zone.rect.col * TILE + 10"
              :y="zone.rect.row * TILE + 16"
              :fill="THEME.zone[zone.colorTheme].label"
              font-size="11"
              font-weight="700"
              font-family="'JetBrains Mono', monospace, system-ui"
              letter-spacing="1"
              text-transform="uppercase"
              opacity="0.7"
            >{{ zone.name.toUpperCase() }}</text>
            <!-- 私密锁图标 -->
            <text
              v-if="zone.isPrivate"
              :x="zone.rect.col * TILE + zone.rect.width * TILE - 20"
              :y="zone.rect.row * TILE + 16"
              font-size="12"
              opacity="0.5"
            >🔒</text>
          </g>

          <!-- 网格线（很淡） -->
          <g v-if="mapDef" opacity="0.04">
            <line
              v-for="c in mapDef.cols"
              :key="`vl${c}`"
              :x1="c * TILE" y1="0"
              :x2="c * TILE" :y2="mapH"
              stroke="white" stroke-width="0.5"
            />
            <line
              v-for="r in mapDef.rows"
              :key="`hl${r}`"
              x1="0" :y1="r * TILE"
              :x2="mapW" :y2="r * TILE"
              stroke="white" stroke-width="0.5"
            />
          </g>

          <!-- 装饰物 -->
          <text
            v-for="(d, di) in decorations"
            :key="`d${di}`"
            :x="d.col * TILE + TILE / 2"
            :y="d.row * TILE + TILE / 2 + 5"
            font-size="18"
            text-anchor="middle"
            opacity="0.5"
          >{{ DECO_EMOJI[d.type] ?? '📦' }}</text>
        </svg>

        <!-- ② 实体层（CSS 动画，绝对定位） -->
        <div
          v-for="entity in entities"
          :key="entity.id"
          class="entity"
          :class="[`pres-${entity.presence}`, { moving: entity.isMoving }]"
          :style="{
            left: `${entity.position.col * TILE + TILE / 2}px`,
            top:  `${entity.position.row * TILE + TILE / 2}px`,
          }"
          @click="onEntityClick(entity)"
          @mouseenter="hoveredId = entity.id"
          @mouseleave="hoveredId = null"
        >
          <!-- 光晕 -->
          <div class="entity-glow" />
          <!-- 头像圆 -->
          <div class="entity-avatar">
            <span class="entity-emoji">{{ entity.avatar }}</span>
          </div>
          <!-- 名牌 -->
          <div class="entity-nametag">{{ entity.displayName }}</div>
          <!-- 状态点 -->
          <div class="entity-dot" />

          <!-- Tooltip（hover 显示） -->
          <div v-if="hoveredId === entity.id" class="entity-tooltip">
            <div class="tt-name">{{ entity.displayName }}</div>
            <div class="tt-status">{{ entity.activityLabel }}</div>
            <div class="tt-zone">📍 {{ zoneNameById(entity.zoneId) }}</div>
            <div class="tt-action">Click to chat →</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 底栏图例 ── -->
    <div class="space-legend">
      <span v-for="item in LEGEND" :key="item.key" class="legend-item">
        <span class="legend-dot" :class="`dot-${item.key}`" />{{ item.label }}
      </span>
      <span class="legend-sep">|</span>
      <span class="legend-hint">Scroll to zoom · Drag to pan · Click worker to chat</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { scenesApi } from '@/api/client'

// ─── scene-core 类型（通过 API 类型镜像，不直接引用后端包） ──────────────────

interface ZoneRect { col: number; row: number; width: number; height: number }
type ColorTheme = 'work' | 'meeting' | 'social' | 'outside'
interface ZoneDef { id: string; name: string; isPrivate: boolean; rect: ZoneRect; colorTheme: ColorTheme; slots: unknown[] }
interface DecorationItem { type: string; col: number; row: number }
interface MapDef { id: string; name: string; theme: string; cols: number; rows: number; zones: ZoneDef[]; decorations: DecorationItem[]; version: string }
interface SceneListItem { id: string; name: string; theme: string; version: string }
type EntityPresence = 'working' | 'meeting' | 'idle' | 'focus' | 'offline'
interface SceneEntity { id: string; displayName: string; avatar: string; presence: EntityPresence; activityLabel: string; zoneId: string; position: { col: number; row: number }; isMoving: boolean }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type SceneSnapshot = Record<string, unknown>

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const TILE = 48

const DECO_EMOJI: Record<string, string> = {
  desk: '🖥️', meeting_table: '📋', sofa: '🛋️', plant: '🌿',
  coffee: '☕', monitor: '💻', game_station: '🎮',
  bookshelf: '📚', whiteboard: '📝', water_cooler: '💧',
}

const THEME = {
  bg: '#0f1117',
  zone: {
    work:    { bg: 'rgba(22,93,255,0.06)',   border: '#1e3a6e', label: '#4a7cbf' },
    meeting: { bg: 'rgba(114,46,209,0.08)',  border: '#3d1f66', label: '#8a5cbf' },
    social:  { bg: 'rgba(0,180,42,0.06)',    border: '#1a4a2e', label: '#3a8a5e' },
    outside: { bg: 'rgba(20,20,20,0.4)',     border: '#333',    label: '#555'    },
  },
}

const LEGEND = [
  { key: 'working', label: 'Working' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'idle',    label: 'Idle'    },
  { key: 'focus',   label: 'Focus'   },
  { key: 'offline', label: 'Offline' },
]

// ─── State ────────────────────────────────────────────────────────────────────

const router   = useRouter()
const sceneId  = ref('default-office')
const sceneList= ref<SceneListItem[]>([])
const mapDef   = ref<MapDef | null>(null)
const snapshot = ref<SceneSnapshot | null>(null)
const hoveredId= ref<string | null>(null)

// Pan & Zoom
const zoom = ref(0.85)
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
const panStart = reactive({ x: 0, y: 0, px: 0, py: 0 })
const viewportRef = ref<HTMLElement | null>(null)

// ─── Computed ─────────────────────────────────────────────────────────────────

const zones = computed<ZoneDef[]>(() => mapDef.value?.zones ?? [])
const decorations = computed<DecorationItem[]>(() => mapDef.value?.decorations ?? [])
const mapW = computed(() => (mapDef.value?.cols ?? 26) * TILE)
const mapH = computed(() => (mapDef.value?.rows ?? 18) * TILE)

const entities = computed<SceneEntity[]>(() => {
  return (snapshot.value as unknown as { entities?: SceneEntity[] })?.entities ?? []
})

const stats = computed(() => {
  const base = { working: 0, meeting: 0, idle: 0, focus: 0, offline: 0 }
  const s = (snapshot.value as unknown as { stats?: Record<string, number> })?.stats ?? {}
  return { ...base, ...s } as Record<EntityPresence, number>
})

function zoneNameById(id: string): string {
  return zones.value.find(z => z.id === id)?.name ?? id
}

// ─── Pan & Zoom ───────────────────────────────────────────────────────────────

function onWheel(e: WheelEvent) {
  const delta = e.deltaY < 0 ? 1.08 : 0.93
  zoom.value = Math.max(0.3, Math.min(2.5, zoom.value * delta))
}
function onPanStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.entity')) return
  panning.value = true
  panStart.x = e.clientX; panStart.y = e.clientY
  panStart.px = panX.value; panStart.py = panY.value
}
function onPanMove(e: MouseEvent) {
  if (!panning.value) return
  panX.value = panStart.px + (e.clientX - panStart.x)
  panY.value = panStart.py + (e.clientY - panStart.y)
}
function onPanEnd() { panning.value = false }

function resetView() {
  if (!viewportRef.value || !mapDef.value) return
  const vw = viewportRef.value.clientWidth
  const vh = viewportRef.value.clientHeight
  zoom.value = Math.min(vw / mapW.value, vh / mapH.value, 1) * 0.88
  panX.value = (vw - mapW.value * zoom.value) / 2
  panY.value = (vh - mapH.value * zoom.value) / 2
}

// ─── Entity Click ─────────────────────────────────────────────────────────────

async function onEntityClick(entity: SceneEntity) {
  const workerId = (entity as unknown as { meta?: { workerId?: string } }).meta?.workerId
  if (!workerId) return
  // 导航到 Chat 页并预选 Worker，创建对话
  await router.push({ name: 'chat', query: { workerId } })
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadScene() {
  const [listRes, mapRes] = await Promise.all([
    scenesApi.list() as Promise<SceneListItem[]>,
    scenesApi.layout(sceneId.value) as unknown as Promise<MapDef>,
  ])
  sceneList.value = listRes
  mapDef.value = mapRes
  resetView()
  await refreshSnapshot()
}

async function refreshSnapshot() {
  const snap = await scenesApi.presence(sceneId.value)
  snapshot.value = snap as unknown as SceneSnapshot
}

// ─── Real-time SSE ────────────────────────────────────────────────────────────

let sse: EventSource | null = null
let fallbackTimer: ReturnType<typeof setInterval> | null = null

function openSSE() {
  closeSSE()
  sse = scenesApi.presenceEvents(sceneId.value)
  sse.addEventListener('snapshot', (e) => {
    try { snapshot.value = JSON.parse((e as MessageEvent<string>).data) } catch { /**/ }
  })
  sse.onerror = () => {
    if (!fallbackTimer) {
      fallbackTimer = setInterval(() => { void refreshSnapshot() }, 5000)
    }
  }
}

function closeSSE() {
  sse?.close(); sse = null
  if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null }
}

onMounted(async () => {
  await loadScene()
  openSSE()
})
onUnmounted(closeSSE)
</script>

<style scoped>
/* ── Layout ── */
.space-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0f1117;
  overflow: hidden;
  user-select: none;
  cursor: default;
}

/* ── Topbar ── */
.space-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 44px;
  background: rgba(15, 17, 23, 0.95);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
  z-index: 10;
  gap: 12px;
}
.topbar-left { display: flex; align-items: baseline; gap: 8px; }
.scene-title  { font-size: 14px; font-weight: 700; color: #e8e8f0; letter-spacing: 0.5px; }
.scene-version{ font-size: 10px; color: #555; font-family: monospace; }
.topbar-center{ flex: 1; display: flex; justify-content: center; }
.topbar-right { display: flex; align-items: center; gap: 8px; }
.zoom-label   { font-size: 11px; color: #666; font-family: monospace; min-width: 42px; text-align: right; }

.stats-row { display: flex; gap: 12px; }
.stat      { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
.stat.working { background: rgba(0,180,42,0.12);  color: #00d633; }
.stat.meeting { background: rgba(114,46,209,0.12); color: #b08ee0; }
.stat.idle    { background: rgba(22,93,255,0.12);  color: #60a0ff; }
.stat.focus   { background: rgba(255,125,0,0.12);  color: #ff9940; }
.stat.offline { background: rgba(80,80,80,0.12);   color: #666; }

/* ── Viewport ── */
.map-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
}
.map-viewport:active { cursor: grabbing; }
.map-canvas {
  position: absolute;
  will-change: transform;
}
.map-svg { display: block; }

/* ── Entity ── */
.entity {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  z-index: 5;
  transition: left 0.65s cubic-bezier(0.4, 0, 0.2, 1),
              top  0.65s cubic-bezier(0.4, 0, 0.2, 1);
}

.entity-glow {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}
.pres-working .entity-glow { background: radial-gradient(circle, rgba(0,214,51,0.3) 0%, transparent 70%); }
.pres-meeting .entity-glow { background: radial-gradient(circle, rgba(160,96,255,0.3) 0%, transparent 70%); }
.pres-idle    .entity-glow { background: radial-gradient(circle, rgba(96,160,255,0.25) 0%, transparent 70%); }
.pres-focus   .entity-glow { background: radial-gradient(circle, rgba(255,153,64,0.3) 0%, transparent 70%); }
.pres-offline .entity-glow { display: none; }

.entity-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid transparent;
  position: relative;
  transition: transform 0.2s ease;
}
.entity:hover .entity-avatar { transform: scale(1.15); }

.pres-working .entity-avatar { background: #0d2a15; border-color: #00b42a; }
.pres-meeting .entity-avatar { background: #1e1030; border-color: #722ed1; }
.pres-idle    .entity-avatar { background: #0d1a30; border-color: #165dff; }
.pres-focus   .entity-avatar { background: #2a1800; border-color: #ff7d00; }
.pres-offline .entity-avatar { background: #1a1a1a; border-color: #444;    opacity: 0.5; }

.entity-emoji {
  font-size: 16px;
  line-height: 1;
  image-rendering: pixelated;
}

.entity-nametag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.3px;
  margin-top: 3px;
  white-space: nowrap;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  font-family: 'JetBrains Mono', monospace, system-ui;
}
.pres-working .entity-nametag { color: #00d633; }
.pres-meeting .entity-nametag { color: #b08ee0; }
.pres-idle    .entity-nametag { color: #60a0ff; }
.pres-focus   .entity-nametag { color: #ff9940; }
.pres-offline .entity-nametag { color: #555; }

.entity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  position: absolute;
  top: -1px;
  right: -1px;
  border: 1.5px solid #0f1117;
}
.pres-working .entity-dot { background: #00d633; }
.pres-meeting .entity-dot { background: #a060ff; }
.pres-idle    .entity-dot { background: #60a0ff; }
.pres-focus   .entity-dot { background: #ff9940; }
.pres-offline .entity-dot { background: #444; }

/* 移动时的轻微抖动动画 */
.entity.moving .entity-avatar {
  animation: walk 0.3s ease;
}
@keyframes walk {
  0%   { transform: translateY(0) scale(1); }
  25%  { transform: translateY(-3px) scale(1.05); }
  50%  { transform: translateY(0) scale(1); }
  75%  { transform: translateY(-2px) scale(1.02); }
  100% { transform: translateY(0) scale(1); }
}

/* Tooltip */
.entity-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 17, 23, 0.97);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 8px 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 4px 20px rgba(0,0,0,0.6);
  min-width: 140px;
}
.tt-name   { font-size: 12px; font-weight: 700; color: #e8e8f0; margin-bottom: 3px; }
.tt-status { font-size: 11px; color: #aaa; margin-bottom: 2px; }
.tt-zone   { font-size: 10px; color: #666; margin-bottom: 4px; }
.tt-action { font-size: 10px; color: #4080ff; font-weight: 600; }

/* ── Legend ── */
.space-legend {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  background: rgba(15, 17, 23, 0.95);
  border-top: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
}
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #666; }
.legend-dot  { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-working { background: #00d633; }
.dot-meeting { background: #a060ff; }
.dot-idle    { background: #60a0ff; }
.dot-focus   { background: #ff9940; }
.dot-offline { background: #444; }
.legend-sep  { color: #333; }
.legend-hint { font-size: 10px; color: #444; margin-left: 4px; }
</style>
