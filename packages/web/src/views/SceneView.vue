<template>
  <div class="scene-view">
    <div class="scene-header">
      <div>
        <h2>{{ t('scene.title') }}</h2>
        <p class="sub">{{ scene?.name || '-' }} · {{ scene?.templateId || '-' }}</p>
      </div>
      <div class="actions">
        <a-select v-model="sceneId" size="small" style="min-width: 180px; margin-right: 8px" @change="handleSceneChange">
          <a-option v-for="item in sceneOptions" :key="item.id" :value="item.id">
            {{ item.name }}
          </a-option>
        </a-select>
        <a-button size="small" @click="loadAll" :loading="loading">Refresh</a-button>
      </div>
    </div>

    <div class="scene-body" v-if="scene && snapshot">
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
              {{ entity.displayName }}
              <span v-if="entity.assetBinding" class="asset-badge">#{{ entity.assetBinding.assetId }}</span>
            </div>
            <div v-if="entitiesByZone(zone.id).length === 0" class="empty">{{ t('common.noData') }}</div>
          </div>
        </div>
      </div>

      <div class="summary-card">
        <h3>{{ t('scene.summary') }}</h3>
        <div class="summary-grid">
          <div class="summary-item"><span>{{ t('scene.total') }}</span><b>{{ snapshot.totals.total }}</b></div>
          <div class="summary-item"><span>{{ t('scene.working') }}</span><b>{{ snapshot.totals.byState.working }}</b></div>
          <div class="summary-item"><span>{{ t('scene.idle') }}</span><b>{{ snapshot.totals.byState.idle }}</b></div>
          <div class="summary-item"><span>{{ t('scene.meeting') }}</span><b>{{ snapshot.totals.byState.meeting }}</b></div>
          <div class="summary-item"><span>{{ t('scene.focus') }}</span><b>{{ snapshot.totals.byState.focus }}</b></div>
          <div class="summary-item"><span>{{ t('scene.offline') }}</span><b>{{ snapshot.totals.byState.offline }}</b></div>
        </div>
        <a-divider style="margin: 12px 0" />
        <h3 style="margin-top: 0">{{ t('scene.residents') }}</h3>
        <div class="resident-list">
          <div class="resident-item" v-for="resident in residents" :key="resident.workerId">
            <div class="resident-main">
              <span>{{ resident.workerName }}</span>
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
    </div>

    <div v-else class="loading-wrap">
      <a-spin />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  scenesApi,
  type SceneDefinition,
  type SceneEntity,
  type SceneListItem,
  type ScenePresenceSnapshot,
  type SceneResident,
} from '@/api/client'

const { t } = useI18n()

const loading = ref(false)
const sceneId = ref('default-office')
const sceneOptions = ref<SceneListItem[]>([])
const scene = ref<SceneDefinition | null>(null)
const snapshot = ref<ScenePresenceSnapshot | null>(null)
const residents = ref<SceneResident[]>([])
let timer: ReturnType<typeof setInterval> | null = null
let eventSource: EventSource | null = null

const allEntities = computed<SceneEntity[]>(() => snapshot.value?.entities ?? [])

function entitiesByZone(zoneId: string) {
  return allEntities.value.filter((item) => item.zoneId === zoneId)
}

async function loadAll() {
  loading.value = true
  try {
    sceneOptions.value = await scenesApi.list()
    scene.value = await scenesApi.get(sceneId.value)
    snapshot.value = await scenesApi.presence(sceneId.value)
    residents.value = (await scenesApi.residents(sceneId.value)).residents
  } finally {
    loading.value = false
  }
}

async function updateResident(workerId: string, isResident: boolean, homeZoneId?: string) {
  await scenesApi.setResident(sceneId.value, workerId, { isResident, homeZoneId })
  residents.value = (await scenesApi.residents(sceneId.value)).residents
  snapshot.value = await scenesApi.presence(sceneId.value)
}

function closeRealtime() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function openRealtime() {
  closeRealtime()
  eventSource = scenesApi.presenceEvents(sceneId.value)
  eventSource.addEventListener('snapshot', (evt) => {
    try {
      snapshot.value = JSON.parse((evt as MessageEvent<string>).data) as ScenePresenceSnapshot
    } catch {
      // ignore parse error
    }
  })
  eventSource.onerror = () => {
    // SSE 不可用时回退为轮询
    if (!timer) {
      timer = setInterval(() => {
        void scenesApi.presence(sceneId.value).then((res) => {
          snapshot.value = res
        })
      }, 5000)
    }
  }
}

async function handleSceneChange() {
  await loadAll()
  openRealtime()
}

onMounted(async () => {
  await loadAll()
  openRealtime()
})

onUnmounted(() => {
  closeRealtime()
})
</script>

<style scoped>
.scene-view { padding: 20px; width: 100%; overflow: auto; }
.scene-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.scene-header h2 { margin: 0; font-size: 22px; }
.sub { color: var(--text-secondary); margin: 4px 0 0; font-size: 12px; }
.scene-body { display: grid; grid-template-columns: 1fr 280px; gap: 14px; }
.zones-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.zone-card { border: 1px solid var(--color-border-2); border-radius: 10px; padding: 12px; background: var(--bg-card); }
.zone-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.zone-meta { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.avatars { display: flex; flex-wrap: wrap; gap: 8px; min-height: 32px; }
.avatar-pill { font-size: 12px; padding: 4px 8px; border-radius: 999px; background: #e8f3ff; color: #165dff; }
.asset-badge { margin-left: 4px; opacity: 0.8; font-size: 10px; }
.avatar-pill.state-working { background: #e8ffea; color: #00b42a; }
.avatar-pill.state-idle { background: #f2f3f5; color: #4e5969; }
.avatar-pill.state-offline { background: #ffece8; color: #f53f3f; }
.avatar-pill.state-meeting { background: #f5e8ff; color: #722ed1; }
.avatar-pill.state-focus { background: #fff7e8; color: #ff7d00; }
.summary-card { border: 1px solid var(--color-border-2); border-radius: 10px; padding: 12px; height: fit-content; background: var(--bg-card); }
.summary-card h3 { margin-top: 0; font-size: 16px; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.summary-item { padding: 8px; border-radius: 8px; background: var(--color-fill-2); display: flex; justify-content: space-between; }
.resident-list { display: flex; flex-direction: column; gap: 8px; }
.resident-item { padding: 8px; border-radius: 8px; background: var(--color-fill-2); }
.resident-main { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 12px; }
.empty { font-size: 12px; color: var(--text-secondary); }
.loading-wrap { display: flex; justify-content: center; align-items: center; min-height: 200px; }
@media (max-width: 1024px) {
  .scene-body { grid-template-columns: 1fr; }
}
</style>
