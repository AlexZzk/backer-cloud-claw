<template>
  <div class="analytics-view">
    <!-- Sub panel -->
    <div class="sub-panel">
      <div class="sub-header">
        <span class="sub-title">{{ t('nav.analytics') }}</span>
        <a-button type="text" size="mini" shape="circle" :loading="loading" @click="fetchData">
          <template #icon><icon-refresh /></template>
        </a-button>
      </div>

      <!-- Period selector -->
      <div class="period-selector">
        <div
          v-for="p in periods"
          :key="p.value"
          class="period-item"
          :class="{ active: selectedPeriod === p.value }"
          @click="selectedPeriod = p.value"
        >
          {{ t(p.labelKey) }}
        </div>
      </div>

      <a-divider style="margin: 8px 0" />

      <!-- Dimension selector -->
      <div class="dimension-label">{{ t('analytics.dimension') }}</div>
      <div class="dimension-selector">
        <div
          v-for="d in dimensions"
          :key="d.value"
          class="period-item"
          :class="{ active: selectedDimension === d.value }"
          @click="selectedDimension = d.value"
        >
          {{ d.label }}
        </div>
      </div>

      <a-divider style="margin: 8px 0" />

      <!-- Summary stats -->
      <div class="summary-stats">
        <div class="summary-item">
          <div class="si-value">{{ formatNumber(apiTotalTokens) }}</div>
          <div class="si-label">{{ t('analytics.totalTokens') }}</div>
        </div>
        <div class="summary-item">
          <div class="si-value">{{ formatNumber(apiTotalInput) }}</div>
          <div class="si-label">{{ t('analytics.inputTokens') }}</div>
        </div>
        <div class="summary-item">
          <div class="si-value">{{ formatNumber(apiTotalOutput) }}</div>
          <div class="si-label">{{ t('analytics.outputTokens') }}</div>
        </div>
        <div class="summary-item">
          <div class="si-value">${{ estimateCost(apiTotalTokens) }}</div>
          <div class="si-label">{{ t('analytics.costEstimate') }}</div>
        </div>
      </div>
    </div>

    <!-- Main charts area -->
    <div class="analytics-main">

      <!-- Empty state -->
      <div v-if="!loading && apiTotalTokens === 0" class="empty-state">
        <div class="es-icon">📊</div>
        <div class="es-title">{{ t('analytics.noData') }}</div>
        <div class="es-desc">与 Worker 对话后，Token 消耗将会显示在这里</div>
      </div>

      <template v-else>
        <!-- Top stat cards -->
        <div class="stat-cards">
          <div class="stat-card" v-for="card in statCards" :key="card.label">
            <div class="sc-icon">{{ card.icon }}</div>
            <div class="sc-content">
              <div class="sc-value">{{ card.value }}</div>
              <div class="sc-label">{{ card.label }}</div>
            </div>
          </div>
        </div>

        <!-- Charts grid -->
        <div class="charts-grid">
          <!-- Daily tokens bar chart -->
          <div class="chart-card span-2">
            <div class="chart-header">
              <h3>{{ t('analytics.tokenUsage') }} — {{ t('analytics.byTime') }}</h3>
              <span class="chart-sub">近 {{ filteredDailyData.length }} 天</span>
            </div>
            <div class="chart-container">
              <div v-if="filteredDailyData.length === 0" class="chart-empty">{{ t('analytics.noData') }}</div>
              <div v-else class="mock-chart line-chart">
                <div class="lc-bars">
                  <div
                    v-for="(item, i) in filteredDailyData"
                    :key="i"
                    class="lc-bar-group"
                  >
                    <div class="lc-input" :style="{ height: `${maxDayVal > 0 ? (item.inputTokens / maxDayVal) * 100 : 0}%` }"></div>
                    <div class="lc-output" :style="{ height: `${maxDayVal > 0 ? (item.outputTokens / maxDayVal) * 100 : 0}%` }"></div>
                    <div class="lc-label">{{ item.date.slice(5) }}</div>
                  </div>
                </div>
                <div class="lc-legend">
                  <span class="legend-dot input"></span> {{ t('analytics.inputTokens') }}
                  <span class="legend-dot output" style="margin-left:16px"></span> {{ t('analytics.outputTokens') }}
                </div>
              </div>
            </div>
          </div>

          <!-- By worker / by dept donut -->
          <div class="chart-card">
            <div class="chart-header">
              <h3>{{ selectedDimension === 'worker' ? t('analytics.byWorker') : t('analytics.byDept') }}</h3>
            </div>
            <div class="chart-container">
              <div v-if="activeDonutData.length === 0" class="chart-empty">{{ t('analytics.noData') }}</div>
              <div v-else class="donut-chart">
                <svg viewBox="0 0 100 100" class="donut-svg">
                  <circle cx="50" cy="50" r="35" fill="none" stroke="var(--border-color)" stroke-width="20"/>
                  <circle
                    v-for="(seg, i) in donutSegments"
                    :key="i"
                    cx="50" cy="50" r="35"
                    fill="none"
                    :stroke="seg.color"
                    stroke-width="20"
                    :stroke-dasharray="`${seg.dash} ${seg.gap}`"
                    :stroke-dashoffset="seg.offset"
                    style="transform: rotate(-90deg); transform-origin: 50% 50%;"
                  />
                  <text x="50" y="46" text-anchor="middle" font-size="9" fill="var(--text-secondary)">总计</text>
                  <text x="50" y="58" text-anchor="middle" font-size="8" font-weight="bold" fill="var(--text-primary)">{{ formatNumber(apiTotalTokens) }}</text>
                </svg>
                <div class="donut-legend">
                  <div v-for="(item, i) in activeDonutData" :key="i" class="dl-item">
                    <span class="dl-dot" :style="{ background: donutColors[i] }"></span>
                    <span class="dl-name">{{ item.name }}</span>
                    <span class="dl-val">{{ formatNumber(item.value) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- By model placeholder (no model breakdown in current API) -->
          <div class="chart-card">
            <div class="chart-header">
              <h3>{{ t('analytics.byModel') }}</h3>
            </div>
            <div class="chart-container">
              <div class="model-bars">
                <div v-for="(item, i) in modelBreakdown" :key="i" class="mb-row">
                  <div class="mb-name">{{ item.name }}</div>
                  <div class="mb-bar-wrap">
                    <div
                      class="mb-bar"
                      :style="{
                        width: `${modelBreakdown[0] && modelBreakdown[0].value > 0 ? (item.value / modelBreakdown[0].value) * 100 : 0}%`,
                        background: i === 0 ? '#165dff' : '#722ed1'
                      }"
                    ></div>
                  </div>
                  <div class="mb-val">{{ formatNumber(item.value) }}</div>
                </div>
                <div v-if="modelBreakdown.length === 0" class="chart-empty">{{ t('analytics.noData') }}</div>
              </div>
            </div>
          </div>

          <!-- Department breakdown -->
          <div v-if="selectedDimension === 'dept'" class="chart-card span-2">
            <div class="chart-header">
              <h3>{{ t('analytics.deptDetail') }}</h3>
            </div>
            <a-table
              :data="deptTableData"
              :bordered="false"
              :pagination="false"
              row-key="deptId"
            >
              <template #columns>
                <a-table-column :title="t('org.department')" data-index="name">
                  <template #cell="{ record }">
                    <span style="font-weight:600">🏢 {{ record.name }}</span>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.inputTokens')" data-index="input">
                  <template #cell="{ record }">{{ formatNumber(record.input) }}</template>
                </a-table-column>
                <a-table-column :title="t('analytics.outputTokens')" data-index="output">
                  <template #cell="{ record }">{{ formatNumber(record.output) }}</template>
                </a-table-column>
                <a-table-column :title="t('analytics.totalTokens')" data-index="value">
                  <template #cell="{ record }">
                    <strong>{{ formatNumber(record.value) }}</strong>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.costEstimate')">
                  <template #cell="{ record }">
                    <span class="cost-cell">${{ estimateCost(record.value) }}</span>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.share')">
                  <template #cell="{ record }">
                    <div class="share-bar-wrap">
                      <div class="share-bar" :style="{ width: `${deptSharePct(record.value)}%` }"></div>
                      <span class="share-pct">{{ deptSharePct(record.value).toFixed(1) }}%</span>
                    </div>
                  </template>
                </a-table-column>
              </template>
            </a-table>

            <!-- Per-dept member breakdown -->
            <div v-for="dept in deptMemberBreakdown" :key="dept.deptId" class="dept-member-block">
              <div class="dmb-header">
                <span class="dmb-dept-name">{{ dept.name }}</span>
                <span class="dmb-total">{{ formatNumber(dept.total) }} tokens</span>
              </div>
              <div class="dmb-members">
                <div v-for="m in dept.members" :key="m.workerId ?? m.name" class="dmb-row">
                  <span class="dmb-avatar">{{ m.avatar }}</span>
                  <span class="dmb-name">{{ m.name }}</span>
                  <span class="dmb-worker" v-if="m.workerName">🤖 {{ m.workerName }}</span>
                  <div class="dmb-bar-wrap">
                    <div class="dmb-bar" :style="{ width: dept.total > 0 ? `${(m.tokens / dept.total) * 100}%` : '0%' }"></div>
                  </div>
                  <span class="dmb-val">{{ formatNumber(m.tokens) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Per-worker breakdown table -->
          <div v-else class="chart-card span-2">
            <div class="chart-header">
              <h3>{{ t('analytics.workerDetail') }}</h3>
            </div>
            <a-table
              :data="workerTableData"
              :bordered="false"
              :pagination="false"
            >
              <template #columns>
                <a-table-column title="Worker" data-index="workerName">
                  <template #cell="{ record }">
                    <span>🤖 {{ record.workerName }}</span>
                  </template>
                </a-table-column>
                <a-table-column :title="t('org.department')" data-index="dept">
                  <template #cell="{ record }">
                    <a-tag v-if="record.dept" size="small" color="arcoblue">{{ record.dept }}</a-tag>
                    <span v-else class="no-dept">—</span>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.inputTokens')" data-index="inputTokens">
                  <template #cell="{ record }">{{ formatNumber(record.inputTokens) }}</template>
                </a-table-column>
                <a-table-column :title="t('analytics.outputTokens')" data-index="outputTokens">
                  <template #cell="{ record }">{{ formatNumber(record.outputTokens) }}</template>
                </a-table-column>
                <a-table-column :title="t('analytics.totalTokens')" data-index="totalTokens">
                  <template #cell="{ record }">
                    <strong>{{ formatNumber(record.totalTokens) }}</strong>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.requestCount')" data-index="callCount" />
                <a-table-column :title="t('analytics.costEstimate')">
                  <template #cell="{ record }">
                    <span class="cost-cell">${{ estimateCost(record.totalTokens) }}</span>
                  </template>
                </a-table-column>
                <a-table-column :title="t('analytics.share')">
                  <template #cell="{ record }">
                    <div class="share-bar-wrap">
                      <div class="share-bar" :style="{ width: `${workerSharePct(record.totalTokens)}%` }"></div>
                      <span class="share-pct">{{ workerSharePct(record.totalTokens).toFixed(1) }}%</span>
                    </div>
                  </template>
                </a-table-column>
              </template>
            </a-table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorkersStore } from '@/stores/workers';
import { analyticsApi, type TokenStats } from '@/api/client';
import { MOCK_COMPANY } from '@/mock/data';

const { t } = useI18n();
const workersStore = useWorkersStore();

const selectedPeriod = ref('month');
const selectedDimension = ref<'worker' | 'dept'>('worker');
const loading = ref(false);
const stats = ref<TokenStats | null>(null);

const periods = [
  { value: 'today',   labelKey: 'analytics.today' },
  { value: 'week',    labelKey: 'analytics.thisWeek' },
  { value: 'month',   labelKey: 'analytics.thisMonth' },
  { value: '30days',  labelKey: 'analytics.last30Days' },
];

const dimensions = computed(() => [
  { value: 'worker', label: t('analytics.byWorker') },
  { value: 'dept',   label: t('analytics.byDept') },
]);

async function fetchData() {
  loading.value = true;
  try {
    const res = await analyticsApi.tokens();
    stats.value = res.data;
  } catch {
    // backend may not be running; ignore
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void workersStore.fetchWorkers();
  void fetchData();
});

// ── Computed from real API ──────────────────────────────────────────────────

const apiTotalInput  = computed(() => stats.value?.totalInputTokens  ?? 0);
const apiTotalOutput = computed(() => stats.value?.totalOutputTokens ?? 0);
const apiTotalTokens = computed(() => stats.value?.totalTokens        ?? 0);

/** Filter byDay to the selected period */
const filteredDailyData = computed(() => {
  const byDay = stats.value?.byDay ?? [];
  const now = Date.now();
  const cutoff: Record<string, number> = {
    today:   now - 1  * 24 * 60 * 60 * 1000,
    week:    now - 7  * 24 * 60 * 60 * 1000,
    month:   now - 30 * 24 * 60 * 60 * 1000,
    '30days':now - 30 * 24 * 60 * 60 * 1000,
  };
  const cutoffMs = cutoff[selectedPeriod.value] ?? cutoff['30days']!;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  return byDay.filter(d => d.date >= cutoffDate);
});

const maxDayVal = computed(() =>
  Math.max(1, ...filteredDailyData.value.map(d => d.inputTokens + d.outputTokens))
);

// Worker table data — real API
const workerTableData = computed(() => {
  const byWorker = stats.value?.byWorker ?? [];
  return byWorker.map(w => {
    // Find department name by mapping workerId through org members
    let dept: string | null = null;
    for (const d of MOCK_COMPANY.departments) {
      if (d.members.some(m => m.workerId === w.workerId)) { dept = d.name; break; }
    }
    return { ...w, dept };
  }).sort((a, b) => b.totalTokens - a.totalTokens);
});

// Department table data — aggregated from real worker data
const deptTableData = computed(() => {
  return MOCK_COMPANY.departments.map(dept => {
    let input = 0, output = 0, value = 0;
    for (const m of dept.members) {
      if (!m.workerId) continue;
      const wt = stats.value?.byWorker.find(w => w.workerId === m.workerId);
      if (wt) { input += wt.inputTokens; output += wt.outputTokens; value += wt.totalTokens; }
    }
    return { deptId: dept.id, name: dept.name, input, output, value };
  }).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
});

// Per-dept member breakdown
const deptMemberBreakdown = computed(() => {
  return MOCK_COMPANY.departments.map(dept => {
    const members = dept.members.map(emp => {
      const wt = emp.workerId ? stats.value?.byWorker.find(w => w.workerId === emp.workerId) : null;
      const workerName = wt?.workerName ?? null;
      return { workerId: emp.workerId ?? null, name: emp.name, avatar: emp.avatar, workerName, tokens: wt?.totalTokens ?? 0 };
    });
    const total = members.reduce((s, m) => s + m.tokens, 0);
    return { deptId: dept.id, name: dept.name, members, total };
  }).filter(d => d.total > 0);
});

const donutColors = ['#165dff', '#722ed1', '#00b42a', '#ff7d00', '#f53f3f'];

const activeDonutData = computed(() => {
  if (selectedDimension.value === 'dept') {
    return deptTableData.value.map(d => ({ name: d.name, value: d.value }));
  }
  return workerTableData.value.map(w => ({ name: w.workerName, value: w.totalTokens }));
});

const donutSegments = computed(() => {
  const data = activeDonutData.value;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];
  const circumference = 2 * Math.PI * 35;
  let offset = 0;
  return data.map((item, i) => {
    const dash = (item.value / total) * circumference;
    const gap  = circumference - dash;
    const seg  = { dash, gap, offset: -offset, color: donutColors[i] ?? '#ccc' };
    offset += dash;
    return seg;
  });
});

// Model breakdown — derived from workers' modelId (from workers store)
const modelBreakdown = computed(() => {
  const map = new Map<string, number>();
  for (const w of (stats.value?.byWorker ?? [])) {
    const worker = workersStore.workers.find(ww => ww.id === w.workerId);
    const modelId = worker?.modelId ?? 'unknown';
    map.set(modelId, (map.get(modelId) ?? 0) + w.totalTokens);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name: name.replace('claude-', '').replace('gpt-', 'GPT-'), value }))
    .sort((a, b) => b.value - a.value);
});

const statCards = computed(() => [
  { icon: '📊', label: t('analytics.totalTokens'),    value: formatNumber(apiTotalTokens.value) },
  { icon: '🔢', label: t('analytics.requestCount'),   value: String(stats.value?.byWorker.reduce((s, w) => s + w.callCount, 0) ?? 0) },
  { icon: '📈', label: t('analytics.inputTokens'),    value: formatNumber(apiTotalInput.value) },
  { icon: '💰', label: t('analytics.costEstimate'),   value: `$${estimateCost(apiTotalTokens.value)}` },
]);

const deptTotal   = computed(() => deptTableData.value.reduce((s, d) => s + d.value, 0));
const workerTotal = computed(() => workerTableData.value.reduce((s, w) => s + w.totalTokens, 0));

function deptSharePct(val: number)   { return deptTotal.value   > 0 ? (val / deptTotal.value)   * 100 : 0; }
function workerSharePct(val: number) { return workerTotal.value > 0 ? (val / workerTotal.value) * 100 : 0; }

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function estimateCost(tokens: number): string {
  return (tokens / 1_000_000 * 3).toFixed(2);
}
</script>

<style scoped>
.analytics-view {
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
  overflow-y: auto;
}

.sub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.sub-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.period-selector, .dimension-selector {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
}

.dimension-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 20px 0;
}

.period-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.period-item:hover { background: rgba(22, 93, 255, 0.05); color: var(--text-primary); }
.period-item.active { background: rgba(22, 93, 255, 0.1); color: #165dff; font-weight: 500; }

.summary-stats {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.si-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.si-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ─── Main ───────────────────────────────────────────────────────────── */

.analytics-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--bg-card);
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  gap: 12px;
  color: var(--text-tertiary);
}

.es-icon { font-size: 48px; }
.es-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); }
.es-desc { font-size: 13px; }

/* Stat cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--border-color);
}

.sc-icon {
  font-size: 28px;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(22, 93, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sc-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.sc-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Charts grid */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.chart-card {
  background: var(--bg-base);
  border-radius: 14px;
  padding: 18px 20px;
  border: 1px solid var(--border-color);
}

.chart-card.span-2 {
  grid-column: span 2;
}

.chart-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.chart-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-sub {
  font-size: 11px;
  color: var(--text-tertiary);
}

.chart-container {
  min-height: 200px;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  font-size: 13px;
  color: var(--text-tertiary);
}

/* ─── Bar Chart ──────────────────────────────────────────────────────── */

.mock-chart {
  height: 200px;
  position: relative;
}

.line-chart {
  display: flex;
  flex-direction: column;
  height: 200px;
}

.lc-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding-bottom: 24px;
  position: relative;
}

.lc-bars::before {
  content: '';
  position: absolute;
  bottom: 24px;
  left: 0; right: 0;
  height: 1px;
  background: var(--border-color);
}

.lc-bar-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  height: 100%;
  justify-content: flex-end;
  position: relative;
}

.lc-input, .lc-output {
  width: 100%;
  border-radius: 3px 3px 0 0;
  transition: height 0.3s ease;
}

.lc-input  { background: rgba(22, 93, 255, 0.55); }
.lc-output { background: rgba(22, 93, 255, 0.18); }

.lc-label {
  position: absolute;
  bottom: 0;
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
  transform: rotate(-20deg);
  transform-origin: top center;
  left: 50%;
  margin-left: -12px;
}

.lc-legend {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 5px;
}

.legend-dot.input  { background: rgba(22, 93, 255, 0.55); }
.legend-dot.output { background: rgba(22, 93, 255, 0.18); }

/* ─── Donut Chart ────────────────────────────────────────────────────── */

.donut-chart {
  display: flex;
  align-items: center;
  gap: 20px;
}

.donut-svg {
  width: 150px;
  height: 150px;
  flex-shrink: 0;
}

.donut-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.dl-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-val  { font-weight: 600; color: var(--text-primary); }

/* ─── Model Bars ─────────────────────────────────────────────────────── */

.model-bars {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 8px;
}

.mb-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mb-name {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: monospace;
}

.mb-bar-wrap {
  height: 8px;
  background: var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.mb-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.mb-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ─── Share Bar ──────────────────────────────────────────────────────── */

.share-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-bar {
  height: 6px;
  border-radius: 3px;
  background: #165dff;
  min-width: 2px;
  max-width: 80px;
  transition: width 0.4s ease;
}

.share-pct {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ─── Dept Member Breakdown ──────────────────────────────────────────── */

.dept-member-block {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

.dmb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.dmb-dept-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.dmb-total {
  font-size: 12px;
  color: var(--text-secondary);
}

.dmb-members {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dmb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.dmb-avatar { font-size: 16px; flex-shrink: 0; }
.dmb-name   { font-weight: 500; color: var(--text-primary); min-width: 60px; }
.dmb-worker { font-size: 11px; color: var(--text-tertiary); min-width: 80px; }

.dmb-bar-wrap {
  flex: 1;
  height: 6px;
  background: var(--border-color);
  border-radius: 3px;
  overflow: hidden;
  min-width: 60px;
}

.dmb-bar {
  height: 100%;
  background: linear-gradient(90deg, #165dff, #722ed1);
  border-radius: 3px;
  transition: width 0.4s ease;
}

.dmb-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 52px;
  text-align: right;
}

/* ─── Cost ───────────────────────────────────────────────────────────── */

.cost-cell { font-weight: 600; color: #165dff; }
.no-dept   { color: var(--text-tertiary); }
</style>
