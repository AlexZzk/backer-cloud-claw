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

    <!-- ── 主体区域 ── -->
    <div class="space-body">

      <!-- 地图容器（pan/zoom 由 CSS transform 实现） -->
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
            width:           `${mapW}px`,
            height:          `${mapH}px`,
            transform:       `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }"
        >
          <!-- Canvas 渲染器（地板 / 家具 / 实体 / 工具提示 全在 Canvas 内） -->
          <OfficeCanvas
            v-if="mapDef"
            :mapDef="mapDef"
            :entities="entities"
            @entityClick="onEntityClick"
            @entityHover="onEntityHover"
          />
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
              <div class="resident-item" v-for="worker in workerList" :key="worker.id">
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

          <!-- 在线状态汇总 -->
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
import OfficeCanvas from '@/components/OfficeCanvas.vue'

// ─── Type mirrors (no direct dep on scene-core) ───────────────────────────────

interface ZoneRect   { col: number; row: number; width: number; height: number }
type  ColorTheme = 'work' | 'meeting' | 'social' | 'outside'
type  ZoneType   = 'work' | 'meeting' | 'social' | 'outside' | 'private'
interface ZoneDef    { id: string; name: string; type: ZoneType; isPrivate: boolean; rect: ZoneRect; colorTheme: ColorTheme }
interface DecoItem   { type: string; col: number; row: number }
interface MapDef     { id: string; name: string; theme: string; cols: number; rows: number; zones: ZoneDef[]; decorations: DecoItem[]; version: string }
interface SceneItem  { id: string; name: string; theme: string; version: string }
type  EntityPresence = 'working' | 'meeting' | 'idle' | 'focus' | 'offline'
interface SceneEntity { id: string; displayName: string; avatar: string; presence: EntityPresence; activityLabel: string; zoneId: string; position: { col: number; row: number }; isMoving: boolean; meta?: Record<string, unknown> }

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE = 48

const LEGEND = [
  { key: 'working', label: 'Working' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'idle',    label: 'Idle'    },
  { key: 'focus',   label: 'Focus'   },
  { key: 'offline', label: 'Offline' },
]

// ─── State ────────────────────────────────────────────────────────────────────

const router    = useRouter()
const sceneId   = ref('default-office')
const sceneList = ref<SceneItem[]>([])
const mapDef    = ref<MapDef | null>(null)
const snapshot  = ref<Record<string, unknown> | null>(null)

// Sidebar
const sidebarOpen = ref(false)
const workerList  = ref<Array<{ id: string; name: string; avatar?: string }>>([])
const residents   = ref<SceneResident[]>([])

// Pan & Zoom
const zoom      = ref(0.85)
const panX      = ref(0)
const panY      = ref(0)
const panning   = ref(false)
const panStart  = reactive({ x: 0, y: 0, px: 0, py: 0 })
const viewportRef = ref<HTMLElement | null>(null)

// ─── Computed ─────────────────────────────────────────────────────────────────

const zones    = computed<ZoneDef[]>(() => mapDef.value?.zones ?? [])
const mapW     = computed(() => (mapDef.value?.cols ?? 36) * TILE)
const mapH     = computed(() => (mapDef.value?.rows ?? 18) * TILE)

const entities = computed<SceneEntity[]>(() => {
  return (snapshot.value as { entities?: SceneEntity[] })?.entities ?? []
})

const stats = computed(() => {
  const base = { working: 0, meeting: 0, idle: 0, focus: 0, offline: 0 }
  const s = (snapshot.value as { stats?: Record<string, number> })?.stats ?? {}
  return { ...base, ...s } as Record<EntityPresence, number>
})

// ─── Resident helpers ─────────────────────────────────────────────────────────

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
  zoom.value = Math.max(0.25, Math.min(2.5, zoom.value * delta))
}

function onPanStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.space-sidebar')) return
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

// ─── Entity interaction ───────────────────────────────────────────────────────

async function onEntityClick(entity: SceneEntity) {
  const workerId = entity.meta?.workerId as string | undefined
  if (!workerId) return
  await router.push({ name: 'chat', query: { workerId } })
}

function onEntityHover(_entityId: string | null) { /* future use */ }

// ─── Data loading ─────────────────────────────────────────────────────────────

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

onMounted(async () => { await loadScene(); openSSE() })
onUnmounted(closeSSE)
</script>

<style scoped>
/* ── Root layout ── */
.space-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #05060c;
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
  background: rgba(5, 6, 12, 0.98);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
  z-index: 20;
  gap: 12px;
}
.topbar-left   { display: flex; align-items: baseline; gap: 8px; }
.scene-title   { font-size: 14px; font-weight: 700; color: #e8e8f0; letter-spacing: 0.5px; }
.scene-version { font-size: 10px; color: #444; font-family: monospace; }
.topbar-center { flex: 1; display: flex; justify-content: center; }
.topbar-right  { display: flex; align-items: center; gap: 6px; }
.zoom-label    { font-size: 11px; color: #555; font-family: monospace; min-width: 42px; text-align: right; }

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

/* ── Sidebar ── */
.space-sidebar {
  width: 264px;
  min-width: 264px;
  background: rgba(8, 9, 16, 0.99);
  border-left: 1px solid rgba(255,255,255,0.07);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 15;
}

.sidebar-enter-active, .sidebar-leave-active {
  transition: width 0.2s ease, min-width 0.2s ease;
}
.sidebar-enter-from, .sidebar-leave-to { width: 0; min-width: 0; }

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}
.sidebar-title {
  font-size: 12px; font-weight: 700;
  color: #a0a0b8; letter-spacing: 1px; text-transform: uppercase;
}
.sidebar-close {
  background: none; border: none; color: #555;
  cursor: pointer; font-size: 13px; padding: 2px 4px;
  border-radius: 4px; transition: color 0.15s;
}
.sidebar-close:hover { color: #ccc; }

.sidebar-section {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.section-label {
  font-size: 10px; font-weight: 700;
  color: #2e3050; letter-spacing: 1.5px; margin-bottom: 10px;
}

/* Residents */
.resident-list { display: flex; flex-direction: column; gap: 8px; }
.resident-item {
  background: rgba(255,255,255,0.025);
  border-radius: 8px; padding: 8px 10px;
  border: 1px solid rgba(255,255,255,0.045);
}
.resident-main { display: flex; align-items: center; gap: 6px; }
.resident-avatar { font-size: 14px; flex-shrink: 0; }
.resident-name {
  flex: 1; font-size: 12px; color: #c0c0d8;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.empty-hint { font-size: 11px; color: #2e3050; padding: 6px 0; text-align: center; }

/* Status grid */
.stats-grid { display: flex; flex-direction: column; gap: 6px; }
.stat-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 8px; border-radius: 6px; font-size: 11px;
  background: rgba(255,255,255,0.025);
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
  display: flex; align-items: center; gap: 14px;
  padding: 0 16px;
  background: rgba(5, 6, 12, 0.98);
  border-top: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
}
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #555; }
.legend-dot  { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-working { background: #00d633; }
.dot-meeting { background: #a060ff; }
.dot-idle    { background: #60a0ff; }
.dot-focus   { background: #ff9940; }
.dot-offline { background: #2e2e2e; }
.legend-sep  { color: #1e2030; }
.legend-hint { font-size: 10px; color: #2a2a40; margin-left: 4px; }
</style>
