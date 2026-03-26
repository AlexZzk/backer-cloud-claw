/**
 * space-runtime/service.ts — BCC HTTP 层的场景服务
 *
 * 职责：
 * - 注册地图到 scene-core 引擎注册表
 * - 为每个 mapId 维护一个 SceneEngine 实例
 * - 提供给 server.ts 调用的公共函数
 *
 * 不了解 Worker 的具体实现，只调用 BCC 适配器获取 EntityInput。
 */

import {
  OFFICE_MAP,
  GAME_STUDIO_MAP,
  registerMap,
  createEngine,
  listMaps,
  getMap,
  type SceneSnapshot,
  type MapDef,
  type EntityInput,
} from '@bcc/scene-core';
import { SceneEngine } from '@bcc/scene-core';

// ── 注册内置地图 ──────────────────────────────────────────────────────────────
registerMap(OFFICE_MAP);
registerMap(GAME_STUDIO_MAP);

export const DEFAULT_SCENE_ID = OFFICE_MAP.id;

// ── 引擎实例缓存 ──────────────────────────────────────────────────────────────
const engines = new Map<string, SceneEngine>();

function getOrCreateEngine(mapId: string): SceneEngine | null {
  if (engines.has(mapId)) return engines.get(mapId)!;
  const engine = createEngine(mapId);
  if (engine) engines.set(mapId, engine);
  return engine;
}

// ── 公共 API（供 server.ts 调用）─────────────────────────────────────────────

export interface SceneListItem {
  id: string;
  name: string;
  theme: MapDef['theme'];
  version: string;
}

export function listScenes(): SceneListItem[] {
  return listMaps().map(m => ({
    id: m.id, name: m.name, theme: m.theme, version: m.version,
  }));
}

export function getSceneDefinition(sceneId: string): MapDef | null {
  return getMap(sceneId);
}

/**
 * buildSceneSnapshot：根据最新的 EntityInput 生成场景快照。
 *
 * 由 server.ts 在每次 /presence 请求或 SSE tick 时调用。
 * inputs 由 BCC 适配器层（bcc-adapter.ts）准备好后传入。
 */
export function buildSceneSnapshot(
  sceneId: string,
  inputs: EntityInput[],
): SceneSnapshot | null {
  const engine = getOrCreateEngine(sceneId);
  if (!engine) return null;
  engine.update(inputs);
  return engine.buildSnapshot();
}

export { getMap };
