<template>
  <canvas
    ref="canvasRef"
    :width="canvasW"
    :height="canvasH"
    class="office-canvas"
    @mousemove="onMouseMove"
    @click="onClick"
    @mouseleave="onMouseLeave"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ZoneRect   { col: number; row: number; width: number; height: number }
type  ColorTheme = 'work' | 'meeting' | 'social' | 'outside'
type  ZoneType   = 'work' | 'meeting' | 'social' | 'outside' | 'private'
interface ZoneDef    { id: string; name: string; type: ZoneType; isPrivate: boolean; rect: ZoneRect; colorTheme: ColorTheme }
interface DecoItem   { type: string; col: number; row: number }
interface MapDef     { id: string; name: string; cols: number; rows: number; zones: ZoneDef[]; decorations: DecoItem[] }
type  EntityPresence = 'working' | 'meeting' | 'idle' | 'focus' | 'offline'
interface SceneEntity {
  id: string; displayName: string; avatar: string
  presence: EntityPresence; activityLabel: string; zoneId: string
  position: { col: number; row: number }
  meta?: Record<string, unknown>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE     = 48    // pixels per map tile
const WALL     = 5     // wall inset per side (px)  →  10px total gap between zones
const AVATAR_R = 17    // avatar circle radius (px)
const LERP     = 0.12  // position lerp speed per rAF

// ─── Zone floor themes ────────────────────────────────────────────────────────

const ZONE_THEME: Record<ColorTheme, {
  f1: string; f2: string; grid: string; border: string; label: string
}> = {
  work: {
    f1: '#0c1928', f2: '#0e1f32',
    grid: 'rgba(255,255,255,0.025)', border: '#1a3a65', label: '#3a7abf',
  },
  meeting: {
    f1: '#0d0b22', f2: '#110e2c',
    grid: 'rgba(255,255,255,0.025)', border: '#2c1a5e', label: '#6a50a8',
  },
  social: {
    f1: '#0b1410', f2: '#0e1a14',
    grid: 'rgba(255,255,255,0.025)', border: '#173525', label: '#357555',
  },
  outside: {
    f1: '#060710', f2: '#080a14',
    grid: 'rgba(255,255,255,0.015)', border: '#101422', label: '#25284a',
  },
}

// ─── Entity state colors ──────────────────────────────────────────────────────

const STATE_C: Record<EntityPresence, {
  bg: string; border: string; glow: string; dot: string; name: string
}> = {
  working: { bg: '#0d2a15', border: '#00b42a', glow: 'rgba(0,180,42,0.22)',     dot: '#00d633', name: '#00d633' },
  meeting: { bg: '#1e1030', border: '#722ed1', glow: 'rgba(114,46,209,0.22)',   dot: '#a060ff', name: '#b08ee0' },
  idle:    { bg: '#0d1a30', border: '#165dff', glow: 'rgba(22,93,255,0.18)',    dot: '#60a0ff', name: '#60a0ff' },
  focus:   { bg: '#2a1800', border: '#ff7d00', glow: 'rgba(255,125,0,0.22)',    dot: '#ff9940', name: '#ff9940' },
  offline: { bg: '#141414', border: '#3a3a3a', glow: 'transparent',             dot: '#2e2e2e', name: '#3e3e3e' },
}

const PRESENCE_LABEL: Record<EntityPresence, string> = {
  working: 'Working', meeting: 'In meeting', idle: 'Idle', focus: 'Focused', offline: 'Offline',
}

// ─── Props & emits ────────────────────────────────────────────────────────────

const props = defineProps<{
  mapDef:   MapDef | null
  entities: SceneEntity[]
  zoneNames?: Map<string, string>
}>()

const emit = defineEmits<{
  entityClick: [entity: SceneEntity]
  entityHover: [entityId: string | null]
}>()

// ─── Canvas state ─────────────────────────────────────────────────────────────

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasW   = computed(() => (props.mapDef?.cols ?? 36) * TILE)
const canvasH   = computed(() => (props.mapDef?.rows ?? 18) * TILE)

let animFrame:    number | null = null
let staticCanvas: HTMLCanvasElement | null = null
let staticDirty = true

/** Smooth render positions keyed by entity.id */
interface RState { x: number; y: number; tx: number; ty: number }
const rStates = new Map<string, RState>()
const hoveredId = ref<string | null>(null)

// ─── Watch ────────────────────────────────────────────────────────────────────

watch(() => props.mapDef, () => { staticDirty = true })
watch(() => props.entities, updateTargets, { deep: false })

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => { animFrame = requestAnimationFrame(renderLoop) })
onUnmounted(() => { if (animFrame) cancelAnimationFrame(animFrame) })

// ─── Render loop ──────────────────────────────────────────────────────────────

function renderLoop() {
  const canvas = canvasRef.value
  const mapDef = props.mapDef

  if (!canvas || !mapDef) {
    animFrame = requestAnimationFrame(renderLoop)
    return
  }

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  // Rebuild static layer if needed
  if (staticDirty || !staticCanvas) {
    staticCanvas = buildStaticLayer(mapDef)
    staticDirty = false
  }

  // Clear with background
  ctx.fillStyle = '#05060c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Static (floor + furniture)
  ctx.drawImage(staticCanvas, 0, 0)

  // Lerp entity positions
  lerpPositions()

  // Entities
  const hover = hoveredId.value
  for (const entity of props.entities) {
    const st = rStates.get(entity.id)
    if (!st) continue
    drawEntity(ctx, entity, st.x, st.y, entity.id === hover, mapDef)
  }

  animFrame = requestAnimationFrame(renderLoop)
}

// ─── Static layer ─────────────────────────────────────────────────────────────

function buildStaticLayer(mapDef: MapDef): HTMLCanvasElement {
  const W = mapDef.cols * TILE
  const H = mapDef.rows * TILE
  const c = document.createElement('canvas')
  c.width  = W
  c.height = H
  const ctx = c.getContext('2d')!

  // Map background (wall / void color)
  ctx.fillStyle = '#05060c'
  ctx.fillRect(0, 0, W, H)

  // Zones (floor tiles + border + label)
  for (const zone of mapDef.zones) {
    drawZone(ctx, zone)
  }

  // Decorations
  for (const d of mapDef.decorations) {
    drawDeco(ctx, d.type, d.col * TILE + TILE / 2, d.row * TILE + TILE / 2)
  }

  return c
}

function drawZone(ctx: CanvasRenderingContext2D, zone: ZoneDef) {
  const th = ZONE_THEME[zone.colorTheme] ?? ZONE_THEME.work
  const { col, row, width, height } = zone.rect
  const bx = col   * TILE
  const by = row   * TILE
  const fw = width  * TILE - WALL * 2
  const fh = height * TILE - WALL * 2

  // ─ Floor tiles (clipped to inset rect) ──────────────────────────────────
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(bx + WALL, by + WALL, fw, fh, 4)
  ctx.clip()

  for (let tc = 0; tc < width; tc++) {
    for (let tr = 0; tr < height; tr++) {
      const tx = bx + tc * TILE
      const ty = by + tr * TILE
      ctx.fillStyle = (tc + tr) % 2 === 0 ? th.f1 : th.f2
      ctx.fillRect(tx, ty, TILE, TILE)
    }
  }

  // Tile grid lines
  ctx.strokeStyle = th.grid
  ctx.lineWidth   = 0.5
  for (let tc = 1; tc < width; tc++) {
    ctx.beginPath()
    ctx.moveTo(bx + tc * TILE, by + WALL)
    ctx.lineTo(bx + tc * TILE, by + WALL + fh)
    ctx.stroke()
  }
  for (let tr = 1; tr < height; tr++) {
    ctx.beginPath()
    ctx.moveTo(bx + WALL, by + tr * TILE)
    ctx.lineTo(bx + WALL + fw, by + tr * TILE)
    ctx.stroke()
  }

  ctx.restore()

  // ─ Zone border ───────────────────────────────────────────────────────────
  ctx.strokeStyle = th.border
  ctx.lineWidth   = zone.isPrivate ? 2 : 1.5
  if (zone.isPrivate) ctx.setLineDash([8, 4])
  ctx.beginPath()
  ctx.roundRect(bx + WALL, by + WALL, fw, fh, 4)
  ctx.stroke()
  ctx.setLineDash([])

  // ─ Zone name ─────────────────────────────────────────────────────────────
  ctx.font        = 'bold 11px "JetBrains Mono", monospace, system-ui'
  ctx.fillStyle   = th.label
  ctx.globalAlpha = 0.8
  ctx.textAlign   = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(zone.name.toUpperCase(), bx + WALL + 10, by + WALL + 7)
  ctx.globalAlpha = 1

  // Lock icon for private zones
  if (zone.isPrivate) {
    ctx.font      = '13px system-ui, sans-serif'
    ctx.globalAlpha = 0.55
    ctx.textAlign = 'right'
    ctx.fillText('🔒', bx + width * TILE - WALL - 6, by + WALL + 5)
    ctx.globalAlpha = 1
  }
}

// ─── Furniture drawing ────────────────────────────────────────────────────────

function drawDeco(ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number) {
  ctx.save()
  switch (type) {

    case 'monitor': {
      // Desk surface
      ctx.fillStyle = '#1e1206'
      ctx.fillRect(cx - 19, cy + 14, 38, 10)
      ctx.fillStyle = 'rgba(255,200,100,0.08)'
      ctx.fillRect(cx - 19, cy + 14, 38, 3)
      // Monitor bezel
      ctx.fillStyle = '#141420'
      rRect(ctx, cx - 16, cy - 13, 32, 22, 3); ctx.fill()
      // Screen
      ctx.fillStyle = '#07172a'
      ctx.fillRect(cx - 13, cy - 10, 26, 16)
      // Screen glow gradient
      const sg = ctx.createLinearGradient(cx - 13, cy - 10, cx - 13, cy + 6)
      sg.addColorStop(0, 'rgba(20,80,200,0.45)')
      sg.addColorStop(1, 'rgba(5,20,60,0.15)')
      ctx.fillStyle = sg
      ctx.fillRect(cx - 13, cy - 10, 26, 16)
      // Code lines on screen
      ctx.fillStyle = 'rgba(100,170,255,0.35)'
      ;[[cx-10,cy-7,18],[cx-10,cy-4,12],[cx-10,cy-1,16],[cx-10,cy+2,8]].forEach(([x,y,w])=>{
        ctx.fillRect(x as number, y as number, w as number, 1.5)
      })
      // Stand
      ctx.fillStyle = '#141420'
      ctx.fillRect(cx - 3, cy + 9, 6, 6)
      ctx.fillRect(cx - 8, cy + 13, 16, 3)
      break
    }

    case 'meeting_table': {
      // Table surface
      ctx.fillStyle = '#152620'
      ctx.fillRect(cx - 22, cy - 14, 44, 28)
      // Surface gradient highlight
      const tg = ctx.createLinearGradient(cx - 22, cy - 14, cx - 22, cy + 14)
      tg.addColorStop(0, 'rgba(255,255,180,0.07)')
      tg.addColorStop(0.5, 'rgba(0,0,0,0)')
      ctx.fillStyle = tg
      ctx.fillRect(cx - 22, cy - 14, 44, 28)
      // Border
      ctx.strokeStyle = '#1f3a2e'
      ctx.lineWidth = 1.5
      ctx.strokeRect(cx - 21, cy - 13, 42, 26)
      break
    }

    case 'sofa': {
      // Armrests
      ctx.fillStyle = '#2e1a0c'
      ctx.fillRect(cx - 20, cy - 6, 7, 18)
      ctx.fillRect(cx + 13, cy - 6, 7, 18)
      // Back cushion
      ctx.fillStyle = '#3e2212'
      ctx.fillRect(cx - 13, cy - 12, 26, 9)
      // Seat
      ctx.fillStyle = '#4a2a16'
      ctx.fillRect(cx - 13, cy - 3, 26, 15)
      // Cushion crease
      ctx.fillStyle = '#2e1808'
      ctx.fillRect(cx - 1, cy - 3, 2, 15)
      // Seat shine
      ctx.fillStyle = 'rgba(255,160,80,0.08)'
      ctx.fillRect(cx - 12, cy - 2, 24, 4)
      break
    }

    case 'plant': {
      // Pot
      ctx.fillStyle = '#5a2210'
      ctx.fillRect(cx - 7, cy + 5, 14, 10)
      ctx.fillStyle = 'rgba(255,130,60,0.15)'
      ctx.fillRect(cx - 7, cy + 5, 14, 3)
      // Leaves
      ctx.fillStyle = '#0d3510'
      ctx.beginPath(); ctx.arc(cx, cy - 6, 11, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#104415'
      ctx.beginPath(); ctx.arc(cx - 7, cy - 10, 8, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#0e4012'
      ctx.beginPath(); ctx.arc(cx + 6, cy - 9, 7, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#155c1e'
      ctx.beginPath(); ctx.arc(cx - 1, cy - 14, 6, 0, Math.PI * 2); ctx.fill()
      break
    }

    case 'bookshelf': {
      // Frame
      ctx.fillStyle = '#160c06'
      ctx.fillRect(cx - 20, cy - 18, 40, 36)
      // Shelves
      ctx.fillStyle = '#0e0804'
      ctx.fillRect(cx - 20, cy - 2, 40, 3)
      ctx.fillRect(cx - 20, cy + 14, 40, 3)
      // Bottom shelf books
      const bc = ['#8a1a1a','#1a4a8a','#4a2a0a','#1a4a1a','#4a1a4a','#8a6a10','#0a4a4a']
      bc.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(cx - 18 + i * 5 + (i > 3 ? 3 : 0), cy + 3, 4, 10)
      })
      // Top shelf books
      const tc = ['#6a1a1a','#2a3a8a','#2a1a6a','#3a6a1a']
      tc.forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(cx - 17 + i * 9, cy - 14, 6, 11)
      })
      break
    }

    case 'whiteboard': {
      // Frame shadow
      ctx.fillStyle = '#101018'
      ctx.fillRect(cx - 21, cy - 16, 42, 32)
      // Frame
      ctx.fillStyle = '#1e1e28'
      ctx.fillRect(cx - 20, cy - 15, 40, 30)
      // Board surface
      ctx.fillStyle = '#dce8f0'
      ctx.fillRect(cx - 17, cy - 12, 34, 23)
      // Writing
      ctx.fillStyle = '#2244aa'
      ctx.fillRect(cx - 12, cy - 8, 22, 2)
      ctx.fillRect(cx - 12, cy - 4, 17, 2)
      ctx.fillRect(cx - 12, cy,     20, 2)
      ctx.fillStyle = '#aa3040'
      ctx.fillRect(cx + 8,  cy - 8, 7, 2)
      ctx.fillStyle = '#22aa44'
      ctx.fillRect(cx + 8,  cy - 4, 5, 2)
      // Marker tray
      ctx.fillStyle = '#808898'
      ctx.fillRect(cx - 17, cy + 11, 34, 4)
      break
    }

    case 'coffee': {
      // Machine body
      ctx.fillStyle = '#181818'
      ctx.fillRect(cx - 12, cy - 16, 24, 30)
      // Panel
      ctx.fillStyle = '#cc3010'
      ctx.fillRect(cx - 8, cy - 10, 16, 12)
      // Button glow
      ctx.fillStyle = '#ff5030'
      ctx.beginPath(); ctx.arc(cx, cy - 4, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,120,60,0.4)'
      ctx.beginPath(); ctx.arc(cx, cy - 4, 7, 0, Math.PI * 2); ctx.fill()
      // Drip tray
      ctx.fillStyle = '#282828'
      ctx.fillRect(cx - 10, cy + 10, 20, 5)
      // Cup
      ctx.fillStyle = '#e8d0a0'
      ctx.fillRect(cx - 5, cy + 6, 10, 5)
      ctx.fillStyle = '#c8a050'
      ctx.fillRect(cx - 5, cy + 6, 10, 1.5)
      break
    }

    case 'water_cooler': {
      // Bottle
      ctx.fillStyle = '#aacce0'
      ctx.beginPath(); ctx.ellipse(cx, cy - 9, 9, 13, 0, 0, Math.PI * 2); ctx.fill()
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath(); ctx.ellipse(cx - 3, cy - 12, 3, 7, -0.25, 0, Math.PI * 2); ctx.fill()
      // Neck
      ctx.fillStyle = '#6a9ab8'
      ctx.fillRect(cx - 4, cy + 3, 8, 5)
      // Stand/body
      ctx.fillStyle = '#3a3a50'
      ctx.fillRect(cx - 11, cy + 6, 22, 18)
      // Dispenser buttons
      ctx.fillStyle = '#ee4444'
      ctx.beginPath(); ctx.arc(cx - 5, cy + 11, 3, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#4488ee'
      ctx.beginPath(); ctx.arc(cx + 5, cy + 11, 3, 0, Math.PI * 2); ctx.fill()
      // Drip tray
      ctx.fillStyle = '#252535'
      ctx.fillRect(cx - 11, cy + 21, 22, 3)
      break
    }

    case 'monitor':  // already handled above (duplicate guard)
    default: {
      ctx.fillStyle = 'rgba(60,60,80,0.5)'
      ctx.fillRect(cx - 8, cy - 8, 16, 16)
    }
  }
  ctx.restore()
}

// ─── Entity drawing ───────────────────────────────────────────────────────────

function drawEntity(
  ctx: CanvasRenderingContext2D,
  entity: SceneEntity,
  x: number, y: number,
  isHovered: boolean,
  mapDef: MapDef,
) {
  const c = STATE_C[entity.presence] ?? STATE_C.offline
  const isOffline = entity.presence === 'offline'

  ctx.save()

  // 1. Glow ring (non-offline)
  if (!isOffline) {
    const grd = ctx.createRadialGradient(x, y, AVATAR_R * 0.4, x, y, AVATAR_R * 3.2)
    grd.addColorStop(0, c.glow)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grd
    ctx.beginPath(); ctx.arc(x, y, AVATAR_R * 3.2, 0, Math.PI * 2); ctx.fill()
  }

  // 2. Avatar background
  ctx.fillStyle = c.bg
  ctx.globalAlpha = isOffline ? 0.45 : 1
  ctx.beginPath(); ctx.arc(x, y, AVATAR_R, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1

  // 3. Border ring
  ctx.strokeStyle = isHovered ? '#ffffff' : c.border
  ctx.lineWidth   = isHovered ? 3 : 2
  ctx.globalAlpha = isOffline ? 0.45 : 1
  ctx.beginPath(); ctx.arc(x, y, AVATAR_R, 0, Math.PI * 2); ctx.stroke()
  ctx.globalAlpha = 1

  // 4. Emoji avatar
  ctx.font          = '17px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  ctx.textAlign     = 'center'
  ctx.textBaseline  = 'middle'
  ctx.globalAlpha   = isOffline ? 0.45 : 1
  ctx.fillText(entity.avatar || '🤖', x, y + 1)
  ctx.globalAlpha = 1

  // 5. Status dot (top-right of avatar)
  const dx = x + AVATAR_R - 5, dy = y - AVATAR_R + 5
  ctx.fillStyle = c.dot
  ctx.beginPath(); ctx.arc(dx, dy, 4.5, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#05060c'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(dx, dy, 4.5, 0, Math.PI * 2); ctx.stroke()

  // 6. Name tag
  const name = entity.displayName.length > 10 ? entity.displayName.slice(0, 9) + '…' : entity.displayName
  ctx.font          = 'bold 9px "JetBrains Mono", monospace, system-ui'
  ctx.textAlign     = 'center'
  ctx.textBaseline  = 'top'
  ctx.fillStyle     = isOffline ? '#3a3a3a' : c.name
  ctx.fillText(name, x, y + AVATAR_R + 4)

  // 7. Tooltip on hover
  if (isHovered) {
    drawTooltip(ctx, entity, x, y, mapDef)
  }

  ctx.restore()
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  entity: SceneEntity,
  ex: number, ey: number,
  mapDef: MapDef,
) {
  const zoneName = mapDef.zones.find(z => z.id === entity.zoneId)?.name ?? entity.zoneId
  const activity = entity.activityLabel || PRESENCE_LABEL[entity.presence]

  const lines = [
    { text: entity.displayName, size: 12, bold: true,  color: '#e8e8f2' },
    { text: activity,           size: 11, bold: false, color: '#aaaacc' },
    { text: `📍 ${zoneName}`,   size: 10, bold: false, color: '#555570' },
    { text: 'Click to chat →',  size: 10, bold: true,  color: '#4080ff' },
  ]

  const padX = 12, padY = 9, lineH = 17
  const W    = 162
  const H    = lines.length * lineH + padY * 2

  let tx = ex - W / 2
  let ty = ey - AVATAR_R - H - 10

  // If too close to top, show below
  if (ty < 4) ty = ey + AVATAR_R + 10

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur  = 12

  // Background
  ctx.fillStyle = 'rgba(5,6,12,0.97)'
  ctx.beginPath(); ctx.roundRect(tx, ty, W, H, 8); ctx.fill()
  ctx.shadowBlur = 0

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.11)'
  ctx.lineWidth   = 1
  ctx.beginPath(); ctx.roundRect(tx, ty, W, H, 8); ctx.stroke()

  // Text lines
  lines.forEach((ln, i) => {
    ctx.font          = `${ln.bold ? 'bold ' : ''}${ln.size}px system-ui, sans-serif`
    ctx.fillStyle     = ln.color
    ctx.textAlign     = 'left'
    ctx.textBaseline  = 'top'
    ctx.fillText(ln.text, tx + padX, ty + padY + i * lineH)
  })
}

// ─── Position lerp ────────────────────────────────────────────────────────────

function updateTargets() {
  const alive = new Set<string>()
  for (const entity of props.entities) {
    const tx = entity.position.col * TILE + TILE / 2
    const ty = entity.position.row * TILE + TILE / 2
    const s  = rStates.get(entity.id)
    if (!s) {
      rStates.set(entity.id, { x: tx, y: ty, tx, ty })
    } else {
      s.tx = tx; s.ty = ty
    }
    alive.add(entity.id)
  }
  for (const id of rStates.keys()) {
    if (!alive.has(id)) rStates.delete(id)
  }
}

function lerpPositions() {
  for (const s of rStates.values()) {
    s.x += (s.tx - s.x) * LERP
    s.y += (s.ty - s.y) * LERP
  }
}

// ─── Mouse interaction ────────────────────────────────────────────────────────

function canvasCoords(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect   = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (canvas.width  / rect.width),
    y: (e.clientY - rect.top)  * (canvas.height / rect.height),
  }
}

function entityAt(x: number, y: number): SceneEntity | null {
  let closest: SceneEntity | null = null
  let minDist = AVATAR_R + 6
  for (const entity of props.entities) {
    const s = rStates.get(entity.id)
    if (!s) continue
    const d = Math.hypot(x - s.x, y - s.y)
    if (d < minDist) { minDist = d; closest = entity }
  }
  return closest
}

function onMouseMove(e: MouseEvent) {
  const { x, y } = canvasCoords(e)
  const hit = entityAt(x, y)
  const next = hit?.id ?? null
  if (next !== hoveredId.value) {
    hoveredId.value = next
    emit('entityHover', next)
    const canvas = canvasRef.value
    if (canvas) canvas.style.cursor = next ? 'pointer' : 'inherit'
  }
}

function onClick(e: MouseEvent) {
  const { x, y } = canvasCoords(e)
  const hit = entityAt(x, y)
  if (hit) emit('entityClick', hit)
}

function onMouseLeave() {
  hoveredId.value = null
  emit('entityHover', null)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** shorthand for ctx.roundRect + ctx.beginPath */
function rRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
}
</script>

<style scoped>
.office-canvas {
  display: block;
  /* actual width/height set via HTML attributes; CSS inherits from parent */
}
</style>
