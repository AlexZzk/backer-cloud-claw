import type { ApiWorker } from '../types.js';
import type {
  PresenceState,
  SceneDefinition,
  SceneEntity,
  SceneListItem,
  ScenePresenceSnapshot,
} from './types.js';

export const DEFAULT_SCENE_ID = 'default-office';
const GAME_SCENE_ID = 'game-studio';

const SCENES: SceneDefinition[] = [
  {
    id: DEFAULT_SCENE_ID,
    name: 'Default Office',
    templateId: 'office-template',
    version: 'v0.1',
    zones: [
      {
        id: 'workstations', name: 'Workstations', type: 'work', capacity: 200, tags: ['desk'],
        anchors: [{ id: 'w-1', x: 8, y: 18 }, { id: 'w-2', x: 20, y: 18 }, { id: 'w-3', x: 32, y: 18 }, { id: 'w-4', x: 44, y: 18 }],
      },
      {
        id: 'meeting-room', name: 'Meeting Room', type: 'meeting', capacity: 50, tags: ['sync'],
        anchors: [{ id: 'm-1', x: 10, y: 10 }, { id: 'm-2', x: 30, y: 10 }, { id: 'm-3', x: 50, y: 10 }],
      },
      {
        id: 'break-room', name: 'Break Room', type: 'social', capacity: 50, tags: ['idle'],
        anchors: [{ id: 'b-1', x: 10, y: 60 }, { id: 'b-2', x: 25, y: 60 }, { id: 'b-3', x: 40, y: 60 }],
      },
      { id: 'outside', name: 'Outside', type: 'system', capacity: 9999, tags: ['offline'] },
    ],
  },
  {
    id: GAME_SCENE_ID,
    name: 'Game Studio',
    templateId: 'game-studio-template',
    version: 'v0.1',
    zones: [
      {
        id: 'dev-pit', name: 'Dev Pit', type: 'work', capacity: 200, tags: ['coding'],
        anchors: [{ id: 'd-1', x: 12, y: 12 }, { id: 'd-2', x: 24, y: 20 }, { id: 'd-3', x: 36, y: 28 }],
      },
      { id: 'war-room', name: 'War Room', type: 'meeting', capacity: 30, tags: ['review'] },
      { id: 'lounge', name: 'Lounge', type: 'social', capacity: 60, tags: ['idle'] },
      { id: 'spawn-outside', name: 'Spawn Outside', type: 'system', capacity: 9999, tags: ['offline'] },
    ],
  },
];

export function listScenes(): SceneListItem[] {
  return SCENES.map(scene => ({
    id: scene.id,
    name: scene.name,
    templateId: scene.templateId,
    version: scene.version,
  }));
}

export function getSceneDefinition(sceneId: string): SceneDefinition | null {
  return SCENES.find(scene => scene.id === sceneId) ?? null;
}

function toPresenceState(status: ApiWorker['status']): PresenceState {
  if (status === 'offline') return 'offline';
  if (status === 'busy') return 'working';
  return 'idle';
}

function toZoneId(sceneId: string, state: PresenceState): string {
  if (sceneId === GAME_SCENE_ID) {
    if (state === 'offline') return 'spawn-outside';
    if (state === 'meeting') return 'war-room';
    if (state === 'working' || state === 'focus') return 'dev-pit';
    return 'lounge';
  }
  if (state === 'offline') return 'outside';
  if (state === 'meeting') return 'meeting-room';
  if (state === 'working' || state === 'focus') return 'workstations';
  return 'break-room';
}

function toActivityLabel(state: PresenceState): string {
  switch (state) {
    case 'offline': return '模型不可用 / 连接异常';
    case 'working': return '处理中';
    case 'meeting': return '会议中';
    case 'focus': return '专注工作';
    case 'idle':
    default:
      return '空闲中';
  }
}

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickAnchor(sceneId: string, zoneId: string, workerId: string) {
  const scene = getSceneDefinition(sceneId);
  const zone = scene?.zones.find(z => z.id === zoneId);
  const anchors = zone?.anchors ?? [];
  if (anchors.length === 0) return null;
  return anchors[stableHash(`${sceneId}:${zoneId}:${workerId}`) % anchors.length] ?? null;
}

export function buildScenePresenceSnapshot(
  sceneId: string,
  workers: Array<{ id: string; name: string; modelId: string }>,
  resolveStatus: (workerId: string) => ApiWorker['status'],
  hints?: {
    meetingWorkerIds?: Set<string>;
    focusWorkerIds?: Set<string>;
    activeTaskWorkerIds?: Set<string>;
    homeZoneByWorkerId?: Map<string, string>;
  },
): ScenePresenceSnapshot | null {
  if (!getSceneDefinition(sceneId)) return null;

  const byState: Record<PresenceState, number> = {
    working: 0,
    idle: 0,
    meeting: 0,
    offline: 0,
    focus: 0,
  };

  const now = Date.now();
  const entities: SceneEntity[] = workers.map((w) => {
    let state = toPresenceState(resolveStatus(w.id));
    if (state !== 'offline' && hints?.activeTaskWorkerIds?.has(w.id)) {
      state = 'working';
    }
    if (state !== 'offline' && hints?.meetingWorkerIds?.has(w.id)) {
      state = 'meeting';
    } else if (state === 'working' && hints?.focusWorkerIds?.has(w.id)) {
      state = 'focus';
    }
    byState[state] += 1;
    const homeZone = hints?.homeZoneByWorkerId?.get(w.id);
    const useHomeZone = !!homeZone && (state === 'idle' || state === 'working');
    const zoneId = useHomeZone ? homeZone : toZoneId(sceneId, state);
    const anchor = pickAnchor(sceneId, zoneId, w.id);
    return {
      entityId: `worker:${w.id}`,
      workerId: w.id,
      displayName: w.name,
      modelId: w.modelId,
      presenceState: state,
      zoneId,
      ...(anchor && { seatId: anchor.id, position: { x: anchor.x, y: anchor.y } }),
      activityLabel: toActivityLabel(state),
      updatedAt: now,
      assetBinding: {
        assetType: 'avatar',
        assetId: `avatar-${w.id}`,
        ownerId: 'org:default',
      },
    };
  });

  return {
    sceneId,
    timestamp: now,
    entities,
    totals: {
      total: entities.length,
      byState,
    },
  };
}
