export type PresenceState = 'working' | 'idle' | 'meeting' | 'offline' | 'focus';

export type SceneZoneType = 'work' | 'meeting' | 'social' | 'private' | 'system' | `custom:${string}`;

export interface SceneZone {
  id: string;
  name: string;
  type: SceneZoneType;
  capacity: number;
  tags?: string[];
  anchors?: Array<{ id: string; x: number; y: number }>;
}

export interface SceneDefinition {
  id: string;
  name: string;
  templateId: string;
  version: string;
  zones: SceneZone[];
}

export interface SceneListItem {
  id: string;
  name: string;
  templateId: string;
  version: string;
}

export interface SceneEntity {
  entityId: string;
  workerId: string;
  displayName: string;
  modelId: string;
  presenceState: PresenceState;
  zoneId: string;
  seatId?: string;
  position?: { x: number; y: number };
  activityLabel: string;
  updatedAt: number;
  assetBinding?: {
    assetType: 'avatar';
    assetId: string;
    ownerId: string;
  };
}

export interface ScenePresenceSnapshot {
  sceneId: string;
  timestamp: number;
  entities: SceneEntity[];
  totals: {
    total: number;
    byState: Record<PresenceState, number>;
  };
}

export interface SceneResident {
  workerId: string;
  sceneId: string;
  isResident: boolean;
  homeZoneId?: string;
}
