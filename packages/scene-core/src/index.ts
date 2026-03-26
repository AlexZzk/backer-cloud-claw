// ─── 类型 ──────────────────────────────────────────────────────────────────
export type {
  TileCoord,
  PixelCoord,
  EntityPresence,
  FacingDirection,
  SceneEntity,
  ZoneSlot,
  ZoneDef,
  ZoneType,
  DecorationType,
  DecorationItem,
  MapTheme,
  MapDef,
  SceneSnapshot,
  ProximityEvent,
  EntityInput,
} from './types.js';

// ─── 引擎 ──────────────────────────────────────────────────────────────────
export {
  SceneEngine,
  registerMap,
  getMap,
  listMaps,
  createEngine,
} from './engine.js';

// ─── 地图模板 ─────────────────────────────────────────────────────────────
export { OFFICE_MAP } from './maps/office.js';
export { GAME_STUDIO_MAP } from './maps/game-studio.js';
