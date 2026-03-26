/**
 * @bcc/scene-core — 核心类型定义
 *
 * 设计原则：
 * - 零外部依赖（不引用任何 @bcc/* 包）
 * - 通用抽象：Entity 可以是 AI Worker、真人用户、或任何可在地图上显示的对象
 * - 可以独立部署为 scene-server，通过 HTTP/WS 接收任意数据源的状态更新
 */

// ─── 坐标 ─────────────────────────────────────────────────────────────────────

/** 网格坐标（以 tile 为单位，左上角为 0,0） */
export interface TileCoord {
  col: number;
  row: number;
}

/** 像素坐标（渲染用） */
export interface PixelCoord {
  x: number;
  y: number;
}

// ─── 实体状态 ─────────────────────────────────────────────────────────────────

/**
 * EntityPresence：实体当前的出现状态。
 *
 * 这是纯粹的场景层概念，不绑定任何业务逻辑。
 * BCC 适配器负责将 Worker lifecycle state 映射到这里。
 */
export type EntityPresence =
  | 'working'   // 正在工作（在工位前）
  | 'meeting'   // 会议中（在会议室）
  | 'idle'      // 空闲（在休息区）
  | 'focus'     // 专注（在工位，Do Not Disturb）
  | 'offline';  // 离线（在场景外部/门口）

/** 实体面朝方向（行走动画用） */
export type FacingDirection = 'down' | 'up' | 'left' | 'right';

// ─── 场景实体 ─────────────────────────────────────────────────────────────────

/**
 * SceneEntity：地图上的一个可见对象。
 *
 * 设计为通用：不假设背后是 AI Worker 还是真人用户。
 * 外部系统通过 adapter 将自己的数据格式转换为此结构。
 */
export interface SceneEntity {
  /** 全局唯一 ID，例如 "worker:alice" 或 "user:bob" */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 头像 emoji 或图片 URL（MVP 用 emoji） */
  avatar: string;
  /** 当前在场状态 */
  presence: EntityPresence;
  /** 当前活动描述（"处理中"、"编写代码"等），供 tooltip 显示 */
  activityLabel: string;
  /** 所在 Zone ID（由 PositionEngine 根据 presence 分配） */
  zoneId: string;
  /** 当前 tile 坐标（由 PositionEngine 分配） */
  position: TileCoord;
  /** 面朝方向（用于 sprite 动画） */
  facing: FacingDirection;
  /** 是否正在移动（触发行走动画） */
  isMoving: boolean;
  /** 任意扩展元数据（调用方自由使用） */
  meta?: Record<string, unknown>;
}

// ─── 区域定义 ─────────────────────────────────────────────────────────────────

export type ZoneType = 'work' | 'meeting' | 'social' | 'outside' | 'private';

/**
 * ZoneSlot：区域内的一个"位置槽"，实体站在这里。
 * 通常是座位、工位等具体位置。
 */
export interface ZoneSlot {
  /** 槽位 ID（在 Zone 内唯一） */
  slotId: string;
  /** 相对于 Zone 左上角的 tile 坐标 */
  localCol: number;
  localRow: number;
  /** 面朝方向（工位通常朝下看屏幕） */
  facing: FacingDirection;
}

/**
 * ZoneDef：地图上的一个功能区域。
 *
 * 区域是场景的核心组织单元，类似 Gather 的 Private Area。
 */
export interface ZoneDef {
  id: string;
  name: string;
  type: ZoneType;
  /** 区域在地图上的矩形范围（tile 单位） */
  rect: { col: number; row: number; width: number; height: number };
  /** 是否为私密区域（内外听不到对方，类似 Gather Private Area） */
  isPrivate: boolean;
  /** 最大容纳人数 */
  capacity: number;
  /** 区域内的位置槽（预分配好的可站位置） */
  slots: ZoneSlot[];
  /**
   * 区域背景色主题
   * 不含具体颜色值，由渲染层决定，保持逻辑/渲染分离
   */
  colorTheme: 'work' | 'meeting' | 'social' | 'outside';
}

// ─── 装饰物 ───────────────────────────────────────────────────────────────────

export type DecorationType =
  | 'desk'
  | 'meeting_table'
  | 'sofa'
  | 'plant'
  | 'coffee'
  | 'monitor'
  | 'game_station'
  | 'bookshelf'
  | 'whiteboard'
  | 'water_cooler';

/**
 * DecorationItem：地图上的静态装饰物（不能被占用，纯视觉）。
 */
export interface DecorationItem {
  type: DecorationType;
  col: number;
  row: number;
  /** 装饰物面朝方向（某些装饰物有朝向） */
  facing?: FacingDirection;
}

// ─── 地图定义 ─────────────────────────────────────────────────────────────────

export type MapTheme = 'office' | 'game_studio' | 'cafe' | 'custom';

/**
 * MapDef：一张完整的 2D 场景地图定义。
 *
 * 这是 scene-core 的顶级数据结构，可以序列化为 JSON 存储/传输。
 * 与具体渲染库无关（不含任何 DOM、Canvas、SVG 引用）。
 */
export interface MapDef {
  /** 地图 ID，例如 "default-office" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 地图主题（影响渲染层的视觉风格） */
  theme: MapTheme;
  /** 水平 tile 数量 */
  cols: number;
  /** 垂直 tile 数量 */
  rows: number;
  /** 区域列表（按渲染层级排序，下层在前） */
  zones: ZoneDef[];
  /** 装饰物列表 */
  decorations: DecorationItem[];
  /** 地图版本（用于缓存失效） */
  version: string;
}

// ─── 场景快照 ─────────────────────────────────────────────────────────────────

/**
 * SceneSnapshot：某一时刻的完整场景状态。
 *
 * 这是服务端向客户端推送的数据单元（SSE event / WebSocket message）。
 * 客户端收到快照后直接替换本地状态，无需 diff。
 */
export interface SceneSnapshot {
  /** 地图 ID */
  mapId: string;
  /** 快照生成时间戳（ms） */
  timestamp: number;
  /** 当前所有实体状态 */
  entities: SceneEntity[];
  /** 各状态人数统计 */
  stats: Record<EntityPresence, number>;
}

// ─── 邻近事件 ────────────────────────────────────────────────────────────────

/**
 * ProximityEvent：某实体进入/离开另一实体的邻近范围。
 *
 * 用于触发"proximity-based"交互（类似 Gather 的自动视频连接）。
 * MVP 阶段作为元数据存储，未来可驱动自动会议触发。
 */
export interface ProximityEvent {
  type: 'enter' | 'leave';
  entityId: string;
  targetId: string;
  distanceTiles: number;
  timestamp: number;
}

// ─── 场景配置（面向外部数据源） ──────────────────────────────────────────────

/**
 * EntityInput：外部数据源提供的实体数据（适配器转换后的中间格式）。
 *
 * 比 SceneEntity 简单：不含位置信息（由 PositionEngine 分配），
 * 不含 facing/isMoving（由引擎管理）。
 */
export interface EntityInput {
  id: string;
  displayName: string;
  avatar: string;
  presence: EntityPresence;
  activityLabel: string;
  /** 希望停留的 Zone ID（可选，引擎会尽量满足） */
  preferredZoneId?: string;
  meta?: Record<string, unknown>;
}
