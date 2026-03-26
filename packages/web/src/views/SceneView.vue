<template>
  <div class="scene-view">
    <!-- ── Header ── -->
    <div class="scene-header">
      <div class="header-left">
        <h2>{{ t('scene.title') }}</h2>
        <p class="sub">{{ scene?.name || '-' }} · {{ scene?.templateId || '-' }}</p>
      </div>
      <div class="header-right">
        <a-select v-model="sceneId" size="small" style="min-width:180px;margin-right:8px" @change="handleSceneChange">
          <a-option v-for="item in sceneOptions" :key="item.id" :value="item.id">{{ item.name }}</a-option>
        </a-select>
        <!-- 视图切换 -->
        <a-button-group size="small" style="margin-right:8px">
          <a-button :type="viewMode === 'map'  ? 'primary' : 'secondary'" @click="viewMode = 'map'">🗺️ Map</a-button>
          <a-button :type="viewMode === 'list' ? 'primary' : 'secondary'" @click="viewMode = 'list'">📋 List</a-button>
        </a-button-group>
        <a-button size="small" @click="loadAll" :loading="loading">Refresh</a-button>
      </div>
    </div>

    <div class="scene-body" v-if="scene && snapshot">
      <!-- ── 左侧主区域 ── -->
      <div class="scene-main">

        <!-- Map 视图 -->
        <template v-if="viewMode === 'map' && layout">
          <SceneMapCanvas
            :layout="layout"
            :snapshot="snapshot"
            :workerAvatars="workerAvatarMap"
            :zoneNames="zoneNameMap"
          />
          <!-- 图例 -->
          <div class="legend">
            <span class="legend-dot" style="background:#00d633"></span> Working
            <span class="legend-dot" style="background:#60a0ff"></span> Idle
            <span class="legend-dot" style="background:#a060ff"></span> Meeting
            <span class="legend-dot" style="background:#ffaa00"></span> Focus
            <span class="legend-dot" style="background:#555"></span> Offline
          </div>
        </template>

        <!-- List 视图（原有卡片布局） -->
        <template v-else>
          <div class="zones-grid">
            <div v-for="zone in scene.zones" :key="zone.id" class="zone-card">
              <div class="zone-top">
                <strong>{{ zone.name }}</strong>
                <a-tag size="small">{{ zone.type }}</a-tag>
              </div>
              <div class="zone-meta">{{ t('scene.capacity') }}: {{ zone.capacity }}</div>
              <div class="avatars">
                <div
                  v-for="entity in entitiesByZone(zone.id)"
                  :key="entity.entityId"
                  class="avatar-pill"
                  :class="`state-${entity.presenceState}`"
                  :title="`${entity.displayName} · ${entity.activityLabel}`"
                >
                  {{ workerEmoji(entity.workerId) }} {{ entity.displayName }}
                  <span v-if="entity.assetBinding" class="asset-badge">#{{ entity.assetBinding.assetId }}</span>
                </div>
                <div v-if="entitiesByZone(zone.id).length === 0" class="empty">{{ t('common.noData') }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ── 右侧面板 ── -->
      <div class="scene-sidebar">
        <!-- 统计汇总 -->
        <div class="panel-card">
          <h3>{{ t('scene.summary') }}</h3>
          <div class="summary-grid">
            <div class="summary-item"><span>{{ t('scene.total') }}</span><b>{{ snapshot.totals.total }}</b></div>
            <div class="summary-item"><span>{{ t('scene.working') }}</span><b class="c-green">{{ snapshot.totals.byState.working }}</b></div>
            <div class="summary-item"><span>{{ t('scene.idle') }}</span><b class="c-blue">{{ snapshot.totals.byState.idle }}</b></div>
            <div class="summary-item"><span>{{ t('scene.meeting') }}</span><b class="c-purple">{{ snapshot.totals.byState.meeting }}</b></div>
            <div class="summary-item"><span>{{ t('scene.focus') }}</span><b class="c-orange">{{ snapshot.totals.byState.focus }}</b></div>
            <div class="summary-item"><span>{{ t('scene.offline') }}</span><b class="c-gray">{{ snapshot.totals.byState.offline }}</b></div>
          </div>
        </div>

        <!-- 入驻员工管理 -->
        <div class="panel-card">
          <h3>{{ t('scene.residents') }}</h3>
          <div class="resident-list">
            <div class="resident-item" v-for="resident in residents" :key="resident.workerId">
              <div class="resident-main">
                <span class="resident-name">{{ workerEmoji(resident.workerId) }} {{ resident.workerName }}</span>
                <a-switch
                  size="small"
                  :model-value="resident.isResident"
                  @change="(val: unknown) => updateResident(resident.workerId, Boolean(val), resident.homeZoneId)"
                />
              </div>
              <a-select
                v-if="resident.isResident"
                size="mini"
                :model-value="resident.homeZoneId"
                allow-clear
                :placeholder="t('scene.homeZone')"
                @change="(val: unknown) => updateResident(resident.workerId, true, val ? String(val) : undefined)"
              >
                <a-option v-for="zone in scene.zones" :key="zone.id" :value="zone.id">{{ zone.name }}</a-option>
              </a-select>
            </div>
          </div>
        </div>

        <!-- Web3 所有权面板 -->
        <div class="panel-card ownership-panel">
          <div class="ownership-header">
            <h3>⛓️ Web3 Ownership</h3>
            <a-tag size="small" color="arcoblue">MVP</a-tag>
          </div>

          <!-- 场景所有权 -->
          <div class="ownership-section" v-if="sceneOwnership">
            <div class="ownership-entity">
              <span class="entity-icon">🏢</span>
              <div class="entity-info">
                <div class="entity-name">{{ scene.name }}</div>
                <div class="entity-type">Scene NFT</div>
              </div>
              <div class="entity-badge" :class="sceneOwnership.listing.status === 'listed' ? 'badge-sale' : 'badge-owned'">
                {{ sceneOwnership.listing.status === 'listed' ? '💰 For Sale' : '🔒 Owned' }}
              </div>
            </div>
            <div class="owner-row">
              <span class="owner-label">Owner:</span>
              <code class="owner-id">{{ shortAddr(sceneOwnership.ownerId) }}</code>
            </div>
            <div class="owner-row" v-if="sceneOwnership.listing.status === 'listed'">
              <span class="owner-label">Price:</span>
              <span class="price-tag">{{ sceneOwnership.listing.price }} {{ sceneOwnership.listing.currency }}</span>
            </div>
            <div class="transfer-count" v-if="sceneOwnership.transferHistory.length > 0">
              {{ sceneOwnership.transferHistory.length }} transfers
            </div>
            <!-- 挂牌/下架按钮 -->
            <div class="ownership-actions">
              <a-button
                v-if="sceneOwnership.listing.status !== 'listed'"
                size="mini"
                type="outline"
                @click="openListModal('scene', sceneId, scene.name)"
              >List for Sale</a-button>
              <a-button
                v-else
                size="mini"
                status="danger"
                type="outline"
                @click="delistItem('scene', sceneId)"
              >Delist</a-button>
            </div>
          </div>

          <!-- 市场挂牌列表 -->
          <div class="marketplace-section" v-if="marketplaceItems.length > 0">
            <div class="section-title">🛒 Marketplace</div>
            <div class="market-item" v-for="item in marketplaceItems" :key="`${item.entityType}:${item.entityId}`">
              <span>{{ entityTypeIcon(item.entityType) }} {{ item.entityName }}</span>
              <span class="price-tag">{{ item.price }} {{ item.currency }}</span>
            </div>
          </div>

          <!-- 公司整体出售 -->
          <div class="company-sale">
            <a-button size="mini" type="secondary" long @click="showCompanySaleModal = true">
              🏭 Sell Entire Company
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="loading-wrap">
      <a-spin />
    </div>

    <!-- ── 挂牌出售弹窗 ── -->
    <a-modal
      v-model:visible="listModal.visible"
      :title="`List for Sale: ${listModal.entityName}`"
      @ok="confirmList"
      @cancel="listModal.visible = false"
    >
      <a-form :model="listModal" layout="vertical">
        <a-form-item label="Price (BCC)">
          <a-input-number v-model="listModal.price" :min="0" :precision="2" style="width:100%" />
        </a-form-item>
        <a-form-item label="Your Owner ID">
          <a-input v-model="listModal.ownerId" placeholder="org:default" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── 整体出售公司弹窗 ── -->
    <a-modal
      v-model:visible="showCompanySaleModal"
      title="Sell Entire Company"
      @ok="confirmCompanySale"
      @cancel="showCompanySaleModal = false"
    >
      <a-form :model="companySale" layout="vertical">
        <a-form-item label="From Owner ID">
          <a-input v-model="companySale.fromOwnerId" placeholder="org:default" />
        </a-form-item>
        <a-form-item label="To Owner ID (Buyer)">
          <a-input v-model="companySale.toOwnerId" placeholder="wallet:0x..." />
        </a-form-item>
        <a-form-item label="Price (BCC)">
          <a-input-number v-model="companySale.price" :min="0" :precision="2" style="width:100%" />
        </a-form-item>
      </a-form>
      <a-alert type="warning" style="margin-top:12px">
        This will transfer ALL scenes and workers to the new owner.
      </a-alert>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  scenesApi,
  ownershipApi,
  workersApi,
  type SceneDefinition,
  type SceneEntity,
  type SceneListItem,
  type ScenePresenceSnapshot,
  type SceneResident,
  type OwnershipRecord,
  type MarketplaceItem,
  type OwnerableEntityType,
} from '@/api/client'
import SceneMapCanvas from '@/components/SceneMapCanvas.vue'
import type { SceneLayout } from '@/api/sceneLayout'

const { t } = useI18n()

// ── State ─────────────────────────────────────────────────────────────────────

const loading = ref(false)
const sceneId = ref('default-office')
const sceneOptions = ref<SceneListItem[]>([])
const scene = ref<SceneDefinition | null>(null)
const snapshot = ref<ScenePresenceSnapshot | null>(null)
const residents = ref<SceneResident[]>([])
const layout = ref<SceneLayout | null>(null)
const viewMode = ref<'map' | 'list'>('map')

// Web3
const sceneOwnership = ref<OwnershipRecord | null>(null)
const marketplaceItems = ref<MarketplaceItem[]>([])
const showCompanySaleModal = ref(false)
const companySale = ref({ fromOwnerId: 'org:default', toOwnerId: '', price: 0 })
const listModal = ref({
  visible: false,
  entityType: '' as OwnerableEntityType,
  entityId: '',
  entityName: '',
  price: 0,
  ownerId: 'org:default',
})

// Workers（for emoji / avatar）
const workerList = ref<Array<{ id: string; avatar?: string; name: string }>>([])

let timer: ReturnType<typeof setInterval> | null = null
let eventSource: EventSource | null = null

// ── Computed ──────────────────────────────────────────────────────────────────

const allEntities = computed<SceneEntity[]>(() => snapshot.value?.entities ?? [])

const workerAvatarMap = computed(() => {
  const m = new Map<string, string>()
  for (const w of workerList.value) {
    m.set(w.id, w.avatar ?? '🤖')
  }
  return m
})

const zoneNameMap = computed(() => {
  const m = new Map<string, string>()
  for (const z of scene.value?.zones ?? []) {
    m.set(z.id, z.name)
  }
  return m
})

function entitiesByZone(zoneId: string) {
  return allEntities.value.filter(e => e.zoneId === zoneId)
}

function workerEmoji(workerId: string): string {
  return workerAvatarMap.value.get(workerId) ?? '🤖'
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadAll() {
  loading.value = true
  try {
    const [scenesRes, sceneRes, presenceRes, residentsRes, workersRes] = await Promise.all([
      scenesApi.list(),
      scenesApi.get(sceneId.value),
      scenesApi.presence(sceneId.value),
      scenesApi.residents(sceneId.value),
      workersApi.list(),
    ])
    sceneOptions.value = scenesRes
    scene.value = sceneRes
    snapshot.value = presenceRes
    residents.value = residentsRes.residents
    workerList.value = workersRes.map(w => ({ id: w.id, avatar: w.avatar, name: w.name }))

    // 2D 布局
    try {
      layout.value = await scenesApi.layout(sceneId.value)
    } catch {
      layout.value = null
    }

    // Web3 所有权
    await loadOwnership()
    await loadMarketplace()
  } finally {
    loading.value = false
  }
}

async function loadOwnership() {
  try {
    sceneOwnership.value = await ownershipApi.get('scene', sceneId.value)
  } catch {
    sceneOwnership.value = null
  }
}

async function loadMarketplace() {
  try {
    marketplaceItems.value = await ownershipApi.marketplace()
  } catch {
    marketplaceItems.value = []
  }
}

// ── Resident Management ───────────────────────────────────────────────────────

async function updateResident(workerId: string, isResident: boolean, homeZoneId?: string) {
  await scenesApi.setResident(sceneId.value, workerId, { isResident, homeZoneId })
  residents.value = (await scenesApi.residents(sceneId.value)).residents
  snapshot.value = await scenesApi.presence(sceneId.value)
}

// ── Real-time ──────────────────────────────────────────────────────────────────

function closeRealtime() {
  if (eventSource) { eventSource.close(); eventSource = null }
  if (timer) { clearInterval(timer); timer = null }
}

function openRealtime() {
  closeRealtime()
  eventSource = scenesApi.presenceEvents(sceneId.value)
  eventSource.addEventListener('snapshot', (evt) => {
    try {
      snapshot.value = JSON.parse((evt as MessageEvent<string>).data) as ScenePresenceSnapshot
    } catch { /* ignore */ }
  })
  eventSource.onerror = () => {
    if (!timer) {
      timer = setInterval(() => {
        void scenesApi.presence(sceneId.value).then(res => { snapshot.value = res })
      }, 5000)
    }
  }
}

async function handleSceneChange() {
  await loadAll()
  openRealtime()
}

// ── Web3 操作 ─────────────────────────────────────────────────────────────────

function openListModal(type: OwnerableEntityType, id: string, name: string) {
  listModal.value = { visible: true, entityType: type, entityId: id, entityName: name, price: 0, ownerId: 'org:default' }
}

async function confirmList() {
  const { entityType, entityId, ownerId, price } = listModal.value
  await ownershipApi.list(entityType, entityId, { ownerId, price, currency: 'BCC' })
  listModal.value.visible = false
  await loadOwnership()
  await loadMarketplace()
}

async function delistItem(type: OwnerableEntityType, id: string) {
  await ownershipApi.delist(type, id, { ownerId: sceneOwnership.value?.ownerId ?? 'org:default' })
  await loadOwnership()
  await loadMarketplace()
}

async function confirmCompanySale() {
  const { fromOwnerId, toOwnerId, price } = companySale.value
  if (!toOwnerId) return
  await ownershipApi.sellCompany('default-company', { fromOwnerId, toOwnerId, price })
  showCompanySaleModal.value = false
  await loadOwnership()
  await loadMarketplace()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(id: string): string {
  if (id.length <= 16) return id
  return id.slice(0, 8) + '…' + id.slice(-6)
}

function entityTypeIcon(type: OwnerableEntityType): string {
  if (type === 'scene') return '🏢'
  if (type === 'worker') return '🤖'
  return '🏭'
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadAll()
  openRealtime()
})

onUnmounted(() => {
  closeRealtime()
})
</script>

<style scoped>
.scene-view { padding: 20px; width: 100%; overflow: auto; box-sizing: border-box; }
.scene-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.scene-header h2 { margin: 0; font-size: 22px; }
.sub { color: var(--text-secondary); margin: 4px 0 0; font-size: 12px; }
.header-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.scene-body { display: grid; grid-template-columns: 1fr 300px; gap: 16px; }
.scene-main { min-width: 0; }

/* 图例 */
.legend { display: flex; gap: 12px; align-items: center; margin-top: 8px; font-size: 12px; color: var(--text-secondary); flex-wrap: wrap; }
.legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }

/* 区域卡片（List 视图） */
.zones-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.zone-card { border: 1px solid var(--color-border-2); border-radius: 10px; padding: 12px; background: var(--bg-card); }
.zone-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.zone-meta { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.avatars { display: flex; flex-wrap: wrap; gap: 8px; min-height: 32px; }
.avatar-pill { font-size: 12px; padding: 4px 8px; border-radius: 999px; background: #e8f3ff; color: #165dff; }
.asset-badge { margin-left: 4px; opacity: 0.8; font-size: 10px; }
.avatar-pill.state-working { background: #e8ffea; color: #00b42a; }
.avatar-pill.state-idle    { background: #f2f3f5; color: #4e5969; }
.avatar-pill.state-offline { background: #ffece8; color: #f53f3f; }
.avatar-pill.state-meeting { background: #f5e8ff; color: #722ed1; }
.avatar-pill.state-focus   { background: #fff7e8; color: #ff7d00; }
.empty { font-size: 12px; color: var(--text-secondary); }

/* 右侧面板 */
.scene-sidebar { display: flex; flex-direction: column; gap: 12px; }
.panel-card { border: 1px solid var(--color-border-2); border-radius: 10px; padding: 12px; background: var(--bg-card); }
.panel-card h3 { margin: 0 0 10px; font-size: 15px; }

/* 汇总 */
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.summary-item { padding: 6px 8px; border-radius: 8px; background: var(--color-fill-2); display: flex; justify-content: space-between; font-size: 12px; }
.c-green  { color: #00b42a; }
.c-blue   { color: #165dff; }
.c-purple { color: #722ed1; }
.c-orange { color: #ff7d00; }
.c-gray   { color: #86909c; }

/* 入驻 */
.resident-list { display: flex; flex-direction: column; gap: 8px; }
.resident-item { padding: 8px; border-radius: 8px; background: var(--color-fill-2); }
.resident-main { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px; }
.resident-name { font-size: 12px; }

/* Web3 所有权 */
.ownership-panel { border-color: #2d3a5e; }
.ownership-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ownership-header h3 { margin: 0; font-size: 14px; }
.ownership-section { background: var(--color-fill-2); border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.ownership-entity { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.entity-icon { font-size: 20px; }
.entity-info { flex: 1; }
.entity-name { font-size: 13px; font-weight: 600; }
.entity-type { font-size: 11px; color: var(--text-secondary); }
.entity-badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
.badge-owned { background: rgba(22,93,255,0.12); color: #4080ff; }
.badge-sale  { background: rgba(255,125,0,0.12); color: #ff7d00; }
.owner-row { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px; }
.owner-label { color: var(--text-secondary); }
.owner-id { font-family: monospace; font-size: 11px; background: var(--color-fill-3); padding: 1px 4px; border-radius: 3px; }
.price-tag { color: #ff7d00; font-weight: 600; font-size: 12px; }
.transfer-count { font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
.ownership-actions { margin-top: 8px; display: flex; gap: 6px; }

.marketplace-section { margin-top: 8px; }
.section-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.market-item { display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--color-fill-3); }
.market-item:last-child { border-bottom: none; }

.company-sale { margin-top: 10px; }

.loading-wrap { display: flex; justify-content: center; align-items: center; min-height: 200px; }

@media (max-width: 1024px) {
  .scene-body { grid-template-columns: 1fr; }
}
</style>
