<template>
  <div class="space-root">

    <!-- ── 顶栏 ── -->
    <div class="space-topbar">
      <div class="topbar-left">
        <span class="scene-title">{{ mapDef?.name ?? '…' }}</span>
        <span class="scene-version">{{ mapDef?.version }}</span>
      </div>
      <div class="topbar-center">
        <div class="stats-row">
          <span class="stat working">⚡ {{ stats.working }}</span>
          <span class="stat meeting">💬 {{ stats.meeting }}</span>
          <span class="stat idle">☕ {{ stats.idle }}</span>
          <span class="stat focus">🎧 {{ stats.focus }}</span>
          <span class="stat offline">💤 {{ stats.offline }}</span>
        </div>
      </div>
      <div class="topbar-right">
        <a-select v-model="sceneId" size="small" style="min-width:160px;margin-right:8px" @change="loadScene">
          <a-option v-for="s in sceneList" :key="s.id" :value="s.id">{{ s.name }}</a-option>
        </a-select>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <a-button size="mini" @click="resetView" title="Reset view">⌂</a-button>
        <a-button
          size="mini"
          :type="sidebarOpen ? 'primary' : 'secondary'"
          @click="sidebarOpen = !sidebarOpen"
          title="Office settings"
        >⚙️</a-button>
      </div>
    </div>

    <!-- ── 主体区域（地图 + 配置侧栏） ── -->
    <div class="space-body">

      <!-- 地图容器 -->
      <div
        class="map-viewport"
        ref="viewportRef"
        @wheel.prevent="onWheel"
        @mousedown="onPanStart"
        @mousemove="onPanMove"
        @mouseup="onPanEnd"
        @mouseleave="onPanEnd"
      >
        <div
          class="map-canvas"
          :style="{
            width:     `${mapW}px`,
            height:    `${mapH}px`,
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }"
        >
          <!-- ① 地板 & 区域（SVG 静态层） -->
          <svg
            :width="mapW"
            :height="mapH"
            class="map-svg"
            style="position:absolute;top:0;left:0;"
          >
            <!-- 地板纹理定义 -->
            <defs>
              <!-- 工作区：深蓝色棋盘格地板 -->
              <pattern id="floor-work" width="96" height="96" patternUnits="userSpaceOnUse">
                <rect width="96" height="96" fill="#091420"/>
                <rect x="0"  y="0"  width="48" height="48" fill="#0d1c2e"/>
                <rect x="48" y="48" width="48" height="48" fill="#0d1c2e"/>
              </pattern>
              <!-- 会议室：深紫色棋盘格 -->
              <pattern id="floor-meeting" width="96" height="96" patternUnits="userSpaceOnUse">
                <rect width="96" height="96" fill="#0a0818"/>
                <rect x="0"  y="0"  width="48" height="48" fill="#110e22"/>
                <rect x="48" y="48" width="48" height="48" fill="#110e22"/>
              </pattern>
              <!-- 休息室：暖绿色棋盘格 -->
              <pattern id="floor-social" width="96" height="96" patternUnits="userSpaceOnUse">
                <rect width="96" height="96" fill="#09120a"/>
                <rect x="0"  y="0"  width="48" height="48" fill="#0e190f"/>
                <rect x="48" y="48" width="48" height="48" fill="#0e190f"/>
              </pattern>
              <!-- 室外：极暗 -->
              <pattern id="floor-outside" width="96" height="96" patternUnits="userSpaceOnUse">
                <rect width="96" height="96" fill="#06070e"/>
                <rect x="0"  y="0"  width="48" height="48" fill="#0a0b15"/>
                <rect x="48" y="48" width="48" height="48" fill="#0a0b15"/>
              </pattern>
            </defs>

            <!-- 全局背景 -->
            <rect width="100%" height="100%" :fill="THEME.bg" />

            <!-- 区域填充 + 边框 + 标签 -->
            <g v-for="zone in zones" :key="`zone-${zone.id}`">
              <!-- 地板纹理 -->
              <rect
                :x="zone.rect.col * TILE + 2"
                :y="zone.rect.row * TILE + 2"
                :width="zone.rect.width * TILE - 4"
                :height="zone.rect.height * TILE - 4"
                :fill="THEME.zone[zone.colorTheme].bg"
                rx="5"
              />
              <!-- 私密区域：虚线边框 -->
              <rect
                v-if="zone.isPrivate"
                :x="zone.rect.col * TILE + 2"
                :y="zone.rect.row * TILE + 2"
                :width="zone.rect.width * TILE - 4"
                :height="zone.rect.height * TILE - 4"
                fill="none"
                :stroke="THEME.zone[zone.colorTheme].border"
                stroke-width="2.5"
                stroke-dasharray="8 4"
                rx="5"
              />
              <!-- 普通区域：实线边框 -->
              <rect
                v-else
                :x="zone.rect.col * TILE + 2"
                :y="zone.rect.row * TILE + 2"
                :width="zone.rect.width * TILE - 4"
                :height="zone.rect.height * TILE - 4"
                fill="none"
                :stroke="THEME.zone[zone.colorTheme].border"
                stroke-width="2"
                rx="5"
              />
              <!-- 区域名称标签 -->
              <text
                :x="zone.rect.col * TILE + 12"
                :y="zone.rect.row * TILE + 18"
                :fill="THEME.zone[zone.colorTheme].label"
                font-size="11"
                font-weight="700"
                font-family="'JetBrains Mono', monospace, system-ui"
                letter-spacing="1.5"
                opacity="0.85"
              >{{ zone.name.toUpperCase() }}</text>
              <!-- 私密区域锁图标 -->
              <text
                v-if="zone.isPrivate"
                :x="zone.rect.col * TILE + zone.rect.width * TILE - 24"
                :y="zone.rect.row * TILE + 19"
                font-size="13"
                opacity="0.55"
              >🔒</text>
            </g>

            <!-- 网格辅助线（极淡） -->
            <g v-if="mapDef" opacity="0.03">
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
              :y="d.row * TILE + TILE / 2 + 6"
              font-size="20"
              text-anchor="middle"
              opacity="0.55"
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
              <div class="tt-status">{{ entity.activityLabel || presenceLabel(entity.presence) }}</div>
              <div class="tt-zone">📍 {{ zoneNameById(entity.zoneId) }}</div>
              <div class="tt-action">Click to chat →</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── 配置侧边栏 ── -->
      <transition name="sidebar">
        <div v-show="sidebarOpen" class="space-sidebar">
          <div class="sidebar-header">
            <span class="sidebar-title">Office Config</span>
            <button class="sidebar-close" @click="sidebarOpen = false">✕</button>
          </div>

          <!-- 入驻员工管理 -->
          <div class="sidebar-section">
            <div class="section-label">RESIDENTS</div>
            <div class="resident-list">
              <div
                class="resident-item"
                v-for="worker in workerList"
                :key="worker.id"
              >
                <div class="resident-main">
                  <span class="resident-avatar">{{ worker.avatar ?? '🤖' }}</span>
                  <span class="resident-name">{{ worker.name }}</span>
                  <a-switch
                    size="small"
                    :model-value="isResident(worker.id)"
                    @change="(val: unknown) => updateResident(worker.id, Boolean(val), residentHomeZone(worker.id))"
                  />
                </div>
                <a-select
                  v-if="isResident(worker.id)"
                  size="mini"
                  :model-value="residentHomeZone(worker.id)"
                  allow-clear
                  placeholder="Home zone…"
                  style="margin-top:6px;width:100%"
                  @change="(val: unknown) => updateResident(worker.id, true, val ? String(val) : undefined)"
                >
                  <a-option
                    v-for="zone in zones.filter(z => z.type !== 'outside')"
                    :key="zone.id"
                    :value="zone.id"
                  >{{ zone.name }}</a-option>
                </a-select>
              </div>
              <div v-if="workerList.length === 0" class="empty-hint">No workers found</div>
            </div>
          </div>

          <!-- 在场统计 -->
          <div class="sidebar-section">
            <div class="section-label">STATUS</div>
            <div class="stats-grid">
              <div class="stat-item working"><span>⚡ Working</span><b>{{ stats.working }}</b></div>
              <div class="stat-item meeting"><span>💬 Meeting</span><b>{{ stats.meeting }}</b></div>
              <div class="stat-item idle"><span>☕ Idle</span><b>{{ stats.idle }}</b></div>
              <div class="stat-item focus"><span>🎧 Focus</span><b>{{ stats.focus }}</b></div>
              <div class="stat-item offline"><span>💤 Offline</span><b>{{ stats.offline }}</b></div>
            </div>
          </div>
        </div>
      </transition>
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
import { scenesApi, workersApi, type SceneResident } from '@/api/client'

// ─── scene-core 类型（镜像，不直接引用后端包） ──────────────────────────────

interface ZoneRect   { col: number; row: number; width: number; height: number }
type  ColorTheme = 'work' | 'meeting' | 'social' | 'outside'
type  ZoneType   = 'work' | 'meeting' | 'social' | 'outside' | 'private'
interface ZoneDef    { id: string; name: string; type: ZoneType; isPrivate: boolean; rect: ZoneRect; colorTheme: ColorTheme; slots: unknown[] }
interface DecoItem   { type: string; col: number; row: number }
interface MapDef     { id: string; name: string; theme: string; cols: number; rows: number; zones: ZoneDef[]; decorations: DecoItem[]; version: string }
interface SceneItem  { id: string; name: string; theme: string; version: string }
type  EntityPresence = 'working' | 'meeting' | 'idle' | 'focus' | 'offline'
interface SceneEntity { id: string; displayName: string; avatar: string; presence: EntityPresence; activityLabel: string; zoneId: string; position: { col: number; row: number }; isMoving: boolean }

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const TILE = 48

const DECO_EMOJI: Record<string, string> = {
  desk:          '🖥️',
  meeting_table: '📋',
  sofa:          '🛋️',
  plant:         '🌿',
  coffee:        '☕',
  monitor:       '💻',
  game_station:  '🎮',
  bookshelf:     '📚',
  whiteboard:    '📝',
  water_cooler:  '💧',
}

const THEME = {
  bg: '#08090f',
  zone: {
    work:    { bg: 'url(#floor-work)',    border: '#1e3a6e', label: '#4a7cbf' },
    meeting: { bg: 'url(#floor-meeting)', border: '#3d1f66', label: '#8a5cbf' },
    social:  { bg: 'url(#floor-social)',  border: '#1a4a2e', label: '#3a8a5e' },
    outside: { bg: 'url(#floor-outside)', border: '#1c1e2e', label: '#383a52' },
  },
}

const LEGEND = [
  { key: 'working', label: 'Working' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'idle',    label: 'Idle'    },
  { key: 'focus',   label: 'Focus'   },
  { key: 'offline', label: 'Offline' },
]

const PRESENCE_LABELS: Record<EntityPresence, string> = {
  working: 'Working',
  meeting: 'In meeting',
  idle:    'Idle',
  focus:   'Focused',
  offline: 'Offline',
}

// ─── State ────────────────────────────────────────────────────────────────────

const router    = useRouter()
const sceneId   = ref('default-office')
const sceneList = ref<SceneItem[]>([])
const mapDef    = ref<MapDef | null>(null)
const snapshot  = ref<Record<string, unknown> | null>(null)
const hoveredId = ref<string | null>(null)

// Sidebar
const sidebarOpen = ref(false)
const workerList  = ref<Array<{ id: string; name: string; avatar?: string }>>([])
const residents   = ref<SceneResident[]>([])

// Pan & Zoom
const zoom     = ref(0.85)
const panX     = ref(0)
const panY     = ref(0)
const panning  = ref(false)
const panStart = reactive({ x: 0, y: 0, px: 0, py: 0 })
const viewportRef = ref<HTMLElement | null>(null)

// ─── Computed ─────────────────────────────────────────────────────────────────

const zones       = computed<ZoneDef[]>(() => mapDef.value?.zones ?? [])
const decorations = computed<DecoItem[]>(() => mapDef.value?.decorations ?? [])
const mapW        = computed(() => (mapDef.value?.cols ?? 36) * TILE)
const mapH        = computed(() => (mapDef.value?.rows ?? 18) * TILE)

const entities = computed<SceneEntity[]>(() => {
  return (snapshot.value as { entities?: SceneEntity[] })?.entities ?? []
})

const stats = computed(() => {
  const base = { working: 0, meeting: 0, idle: 0, focus: 0, offline: 0 }
  const s = (snapshot.value as { stats?: Record<string, number> })?.stats ?? {}
  return { ...base, ...s } as Record<EntityPresence, number>
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function zoneNameById(id: string): string {
  return zones.value.find(z => z.id === id)?.name ?? id
}

function presenceLabel(p: EntityPresence): string {
  return PRESENCE_LABELS[p] ?? p
}

function isResident(workerId: string): boolean {
  return residents.value.find(r => r.workerId === workerId)?.isResident ?? false
}

function residentHomeZone(workerId: string): string | undefined {
  return residents.value.find(r => r.workerId === workerId)?.homeZoneId
}

async function updateResident(workerId: string, isRes: boolean, homeZoneId?: string) {
  await scenesApi.setResident(sceneId.value, workerId, { isResident: isRes, homeZoneId })
  const res = await scenesApi.residents(sceneId.value)
  residents.value = res.residents
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

// ─── Entity click ─────────────────────────────────────────────────────────────

async function onEntityClick(entity: SceneEntity) {
  const workerId = (entity as { meta?: { workerId?: string } }).meta?.workerId
  if (!workerId) return
  await router.push({ name: 'chat', query: { workerId } })
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadScene() {
  const [listRes, mapRes, workersRes, residentsRes] = await Promise.all([
    scenesApi.list() as Promise<SceneItem[]>,
    scenesApi.layout(sceneId.value) as unknown as Promise<MapDef>,
    workersApi.list(),
    scenesApi.residents(sceneId.value),
  ])
  sceneList.value  = listRes
  mapDef.value     = mapRes
  workerList.value = workersRes.map(w => ({ id: w.id, name: w.name, avatar: w.avatar }))
  residents.value  = residentsRes.residents
  resetView()
  await refreshSnapshot()
}

async function refreshSnapshot() {
  const snap = await scenesApi.presence(sceneId.value)
  snapshot.value = snap as unknown as Record<string, unknown>
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
/* ── Root layout ── */
.space-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #08090f;
  overflow: hidden;
  user-select: none;
}

/* ── Topbar ── */
.space-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 44px;
  background: rgba(8, 9, 15, 0.98);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
  z-index: 20;
  gap: 12px;
}
.topbar-left  { display: flex; align-items: baseline; gap: 8px; }
.scene-title  { font-size: 14px; font-weight: 700; color: #e8e8f0; letter-spacing: 0.5px; }
.scene-version{ font-size: 10px; color: #444; font-family: monospace; }
.topbar-center{ flex: 1; display: flex; justify-content: center; }
.topbar-right { display: flex; align-items: center; gap: 6px; }
.zoom-label   { font-size: 11px; color: #555; font-family: monospace; min-width: 42px; text-align: right; }

.stats-row { display: flex; gap: 8px; }
.stat      { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap; }
.stat.working { background: rgba(0,180,42,0.12);  color: #00d633; }
.stat.meeting { background: rgba(114,46,209,0.12); color: #b08ee0; }
.stat.idle    { background: rgba(22,93,255,0.12);  color: #60a0ff; }
.stat.focus   { background: rgba(255,125,0,0.12);  color: #ff9940; }
.stat.offline { background: rgba(80,80,80,0.10);   color: #555; }

/* ── Body ── */
.space-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* ── Viewport ── */
.map-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
  min-width: 0;
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
  transition: left 0.65s cubic-bezier(0.4,0,0.2,1),
              top  0.65s cubic-bezier(0.4,0,0.2,1);
}

.entity-glow {
  position: absolute;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}
.pres-working .entity-glow { background: radial-gradient(circle, rgba(0,214,51,0.28) 0%, transparent 70%); }
.pres-meeting .entity-glow { background: radial-gradient(circle, rgba(160,96,255,0.28) 0%, transparent 70%); }
.pres-idle    .entity-glow { background: radial-gradient(circle, rgba(96,160,255,0.22) 0%, transparent 70%); }
.pres-focus   .entity-glow { background: radial-gradient(circle, rgba(255,153,64,0.28) 0%, transparent 70%); }
.pres-offline .entity-glow { display: none; }

.entity-avatar {
  width: 34px;
  height: 34px;
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
.pres-offline .entity-avatar { background: #1a1a1a; border-color: #3a3a3a; opacity: 0.5; }

.entity-emoji {
  font-size: 17px;
  line-height: 1;
}

.entity-nametag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.3px;
  margin-top: 3px;
  white-space: nowrap;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  font-family: 'JetBrains Mono', monospace, system-ui;
}
.pres-working .entity-nametag { color: #00d633; }
.pres-meeting .entity-nametag { color: #b08ee0; }
.pres-idle    .entity-nametag { color: #60a0ff; }
.pres-focus   .entity-nametag { color: #ff9940; }
.pres-offline .entity-nametag { color: #444; }

.entity-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  position: absolute;
  top: -2px;
  right: -2px;
  border: 1.5px solid #08090f;
}
.pres-working .entity-dot { background: #00d633; }
.pres-meeting .entity-dot { background: #a060ff; }
.pres-idle    .entity-dot { background: #60a0ff; }
.pres-focus   .entity-dot { background: #ff9940; }
.pres-offline .entity-dot { background: #333; }

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
  background: rgba(8, 9, 15, 0.97);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 8px 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 4px 20px rgba(0,0,0,0.7);
  min-width: 140px;
}
.tt-name   { font-size: 12px; font-weight: 700; color: #e8e8f0; margin-bottom: 3px; }
.tt-status { font-size: 11px; color: #aaa; margin-bottom: 2px; }
.tt-zone   { font-size: 10px; color: #555; margin-bottom: 4px; }
.tt-action { font-size: 10px; color: #4080ff; font-weight: 600; }

/* ── Sidebar ── */
.space-sidebar {
  width: 264px;
  min-width: 264px;
  background: rgba(10, 11, 18, 0.98);
  border-left: 1px solid rgba(255,255,255,0.07);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 15;
}

.sidebar-enter-active,
.sidebar-leave-active {
  transition: width 0.2s ease, min-width 0.2s ease;
}
.sidebar-enter-from,
.sidebar-leave-to {
  width: 0;
  min-width: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}
.sidebar-title {
  font-size: 12px;
  font-weight: 700;
  color: #a0a0b8;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.sidebar-close {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}
.sidebar-close:hover { color: #ccc; }

.sidebar-section {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.section-label {
  font-size: 10px;
  font-weight: 700;
  color: #3a3d55;
  letter-spacing: 1.5px;
  margin-bottom: 10px;
}

/* Residents list */
.resident-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.resident-item {
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255,255,255,0.05);
}
.resident-main {
  display: flex;
  align-items: center;
  gap: 6px;
}
.resident-avatar { font-size: 14px; flex-shrink: 0; }
.resident-name {
  flex: 1;
  font-size: 12px;
  color: #c0c0d8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-hint {
  font-size: 11px;
  color: #3a3a55;
  padding: 6px 0;
  text-align: center;
}

/* Status grid in sidebar */
.stats-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(255,255,255,0.03);
}
.stat-item b { font-size: 13px; font-weight: 700; }
.stat-item.working { color: #00d633; }
.stat-item.meeting { color: #b08ee0; }
.stat-item.idle    { color: #60a0ff; }
.stat-item.focus   { color: #ff9940; }
.stat-item.offline { color: #555; }

/* ── Legend ── */
.space-legend {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  background: rgba(8, 9, 15, 0.98);
  border-top: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
}
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #555; }
.legend-dot  { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-working { background: #00d633; }
.dot-meeting { background: #a060ff; }
.dot-idle    { background: #60a0ff; }
.dot-focus   { background: #ff9940; }
.dot-offline { background: #333; }
.legend-sep  { color: #222; }
.legend-hint { font-size: 10px; color: #333; margin-left: 4px; }
</style>
