/**
 * SceneEngine — 场景核心引擎
 *
 * 职责：
 * 1. 维护当前 EntityInput 列表
 * 2. 根据 presence 状态将实体分配到对应 Zone
 * 3. 在 Zone 内分配具体 slot（工位/座位）
 * 4. 计算邻近关系（proximity）
 * 5. 生成可供渲染的 SceneSnapshot
 *
 * 零外部依赖，可在 Node.js 或浏览器中运行。
 */

import type {
  MapDef,
  ZoneDef,
  ZoneSlot,
  EntityInput,
  SceneEntity,
  SceneSnapshot,
  EntityPresence,
  TileCoord,
  ProximityEvent,
  FacingDirection,
} from './types.js';

// ─── presence → zone 映射规则 ────────────────────────────────────────────────

const PRESENCE_ZONE_PRIORITY: Record<EntityPresence, string[]> = {
  working:  ['workstations', 'dev-pit'],       // 工作 → 工位区
  focus:    ['workstations', 'dev-pit'],       // 专注 → 工位区
  meeting:  ['meeting-room', 'war-room'],      // 会议 → 会议室
  idle:     ['break-room', 'lounge'],          // 空闲 → 休息区
  offline:  ['outside', 'spawn-outside'],     // 离线 → 室外
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.sqrt((a.col - b.col) ** 2 + (a.row - b.row) ** 2);
}

function toAbsCoord(zone: ZoneDef, slot: ZoneSlot): TileCoord {
  return {
    col: zone.rect.col + slot.localCol,
    row: zone.rect.row + slot.localRow,
  };
}

/** 在 Zone 中央区域生成溢出位置（当 slot 不足时） */
function overflowPosition(zone: ZoneDef, index: number): TileCoord {
  const cols = Math.max(1, zone.rect.width - 2);
  return {
    col: zone.rect.col + 1 + (index % cols),
    row: zone.rect.row + 1 + Math.floor(index / cols),
  };
}

// ─── SceneEngine ──────────────────────────────────────────────────────────────

export class SceneEngine {
  private readonly map: MapDef;
  /** 当前 entity 列表（最新状态） */
  private inputs: EntityInput[] = [];
  /** 上一次生成的快照（用于增量 diff） */
  private lastSnapshot: SceneSnapshot | null = null;
  /** entity 持久化分配的工位 slot（工作/专注状态时保持同一工位） */
  private stickySlots = new Map<string, string>();  // entityId → slotId

  constructor(map: MapDef) {
    this.map = map;
  }

  // ── 公共 API ───────────────────────────────────────────────────────────────

  /** 更新实体列表（外部每次 tick 调用一次） */
  update(inputs: EntityInput[]): void {
    this.inputs = inputs;
  }

  /** 生成当前时刻的完整场景快照 */
  buildSnapshot(): SceneSnapshot {
    const entities = this.assignPositions(this.inputs);
    const stats = this.calcStats(entities);
    const snapshot: SceneSnapshot = {
      mapId: this.map.id,
      timestamp: Date.now(),
      entities,
      stats,
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  /** 计算邻近事件（与上次快照对比） */
  computeProximityEvents(
    current: SceneSnapshot,
    previous: SceneSnapshot | null,
    radiusTiles = 5,
  ): ProximityEvent[] {
    const events: ProximityEvent[] = [];
    if (!previous) return events;

    const now = Date.now();
    for (const entity of current.entities) {
      for (const other of current.entities) {
        if (entity.id === other.id) continue;
        const dist = tileDistance(entity.position, other.position);
        const wasNear = (() => {
          const prevE = previous.entities.find(e => e.id === entity.id);
          const prevO = previous.entities.find(e => e.id === other.id);
          if (!prevE || !prevO) return false;
          return tileDistance(prevE.position, prevO.position) <= radiusTiles;
        })();
        const isNear = dist <= radiusTiles;
        if (isNear && !wasNear) {
          events.push({ type: 'enter', entityId: entity.id, targetId: other.id, distanceTiles: dist, timestamp: now });
        } else if (!isNear && wasNear) {
          events.push({ type: 'leave', entityId: entity.id, targetId: other.id, distanceTiles: dist, timestamp: now });
        }
      }
    }
    return events;
  }

  getMap(): MapDef {
    return this.map;
  }

  getLastSnapshot(): SceneSnapshot | null {
    return this.lastSnapshot;
  }

  // ── 位置分配 ──────────────────────────────────────────────────────────────

  private assignPositions(inputs: EntityInput[]): SceneEntity[] {
    // 按 presence 分组
    const groups = new Map<EntityPresence, EntityInput[]>();
    for (const input of inputs) {
      const g = groups.get(input.presence) ?? [];
      g.push(input);
      groups.set(input.presence, g);
    }

    // 为每个 presence 组找对应 zone，分配 slot
    const usedSlots = new Map<string, Set<string>>();  // zoneId → Set<slotId>
    const result: SceneEntity[] = [];

    for (const [presence, group] of groups) {
      const targetZone = this.resolveZone(presence, group[0]?.preferredZoneId);
      if (!targetZone) continue;

      const used = usedSlots.get(targetZone.id) ?? new Set();
      usedSlots.set(targetZone.id, used);

      for (const input of group) {
        const { slot, coord } = this.allocateSlot(input, targetZone, used);
        if (slot) used.add(slot.slotId);

        const entity: SceneEntity = {
          id: input.id,
          displayName: input.displayName,
          avatar: input.avatar,
          presence: input.presence,
          activityLabel: input.activityLabel,
          zoneId: targetZone.id,
          position: coord,
          facing: slot?.facing ?? 'down',
          isMoving: this.hasPositionChanged(input.id, coord),
          ...(input.meta !== undefined && { meta: input.meta }),
        };
        result.push(entity);
      }
    }

    return result;
  }

  /** 根据 presence 找到最合适的 Zone */
  private resolveZone(presence: EntityPresence, preferredZoneId?: string): ZoneDef | null {
    // 1. 尝试 preferredZoneId（如果有且类型匹配）
    if (preferredZoneId) {
      const preferred = this.map.zones.find(z => z.id === preferredZoneId);
      if (preferred) return preferred;
    }
    // 2. 按优先级找第一个可用 Zone
    const candidates = PRESENCE_ZONE_PRIORITY[presence] ?? [];
    for (const zoneId of candidates) {
      const zone = this.map.zones.find(z => z.id === zoneId);
      if (zone) return zone;
    }
    // 3. fallback: 取第一个 zone
    return this.map.zones[0] ?? null;
  }

  /** 在 Zone 内为实体分配 slot */
  private allocateSlot(
    input: EntityInput,
    zone: ZoneDef,
    usedSlotIds: Set<string>,
  ): { slot: ZoneSlot | null; coord: TileCoord } {
    const isWorkLike = input.presence === 'working' || input.presence === 'focus';

    // 工作状态：尽量保持同一工位（sticky slot）
    if (isWorkLike) {
      const sticky = this.stickySlots.get(input.id);
      if (sticky) {
        const slot = zone.slots.find(s => s.slotId === sticky && !usedSlotIds.has(s.slotId));
        if (slot) {
          return { slot, coord: toAbsCoord(zone, slot) };
        }
      }
    }

    // 找第一个未被占用的 slot
    for (const slot of zone.slots) {
      if (!usedSlotIds.has(slot.slotId)) {
        if (isWorkLike) this.stickySlots.set(input.id, slot.slotId);
        return { slot, coord: toAbsCoord(zone, slot) };
      }
    }

    // slot 用完，溢出
    const overflowIdx = usedSlotIds.size;
    return { slot: null, coord: overflowPosition(zone, overflowIdx) };
  }

  /** 判断实体位置是否发生变化（触发移动动画） */
  private hasPositionChanged(entityId: string, newPos: TileCoord): boolean {
    if (!this.lastSnapshot) return false;
    const prev = this.lastSnapshot.entities.find(e => e.id === entityId);
    if (!prev) return false;
    return prev.position.col !== newPos.col || prev.position.row !== newPos.row;
  }

  private calcStats(entities: SceneEntity[]): Record<EntityPresence, number> {
    const stats: Record<EntityPresence, number> = {
      working: 0, meeting: 0, idle: 0, focus: 0, offline: 0,
    };
    for (const e of entities) {
      stats[e.presence] = (stats[e.presence] ?? 0) + 1;
    }
    return stats;
  }
}

// ─── 地图注册表 ────────────────────────────────────────────────────────────────

const registry = new Map<string, MapDef>();

export function registerMap(map: MapDef): void {
  registry.set(map.id, map);
}

export function getMap(id: string): MapDef | null {
  return registry.get(id) ?? null;
}

export function listMaps(): MapDef[] {
  return Array.from(registry.values());
}

/** 为一张地图创建引擎实例 */
export function createEngine(mapId: string): SceneEngine | null {
  const map = getMap(mapId);
  if (!map) return null;
  return new SceneEngine(map);
}
