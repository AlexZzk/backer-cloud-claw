/**
 * space-runtime/layout.ts — 场景 2D 布局定义
 *
 * 为 Gather 风格的可视化地图提供每个场景的网格布局数据。
 * 坐标系：左上角为 (0,0)，x 向右，y 向下。
 * 单位：格子（tile），每格在前端渲染为 ~40px。
 */

/** 场景区域在 2D 网格中的矩形范围 */
export interface ZoneRect {
  zoneId: string;
  /** 左上角列（0-based） */
  col: number;
  /** 左上角行（0-based） */
  row: number;
  /** 宽度（格子数） */
  width: number;
  /** 高度（格子数） */
  height: number;
  /** 区域内部装饰（可选，前端绘制用） */
  decorations?: ZoneDecoration[];
}

export type ZoneDecorationType =
  | 'desk'
  | 'meeting_table'
  | 'sofa'
  | 'plant'
  | 'coffee'
  | 'monitor'
  | 'game_station';

export interface ZoneDecoration {
  type: ZoneDecorationType;
  col: number;   // 相对于 ZoneRect 左上角
  row: number;
}

/** 场景 2D 布局描述 */
export interface SceneLayout {
  sceneId: string;
  /** 网格总列数 */
  cols: number;
  /** 网格总行数 */
  rows: number;
  /** 背景主题 */
  theme: 'office' | 'game_studio';
  /** 每个区域的矩形范围 */
  zoneRects: ZoneRect[];
}

// ─── 预定义布局 ──────────────────────────────────────────────────────────────

/** 默认办公室布局（24×16 网格） */
const OFFICE_LAYOUT: SceneLayout = {
  sceneId: 'default-office',
  cols: 24,
  rows: 16,
  theme: 'office',
  zoneRects: [
    {
      zoneId: 'workstations',
      col: 0, row: 0, width: 16, height: 10,
      decorations: [
        { type: 'desk', col: 1, row: 1 },
        { type: 'desk', col: 4, row: 1 },
        { type: 'desk', col: 7, row: 1 },
        { type: 'desk', col: 10, row: 1 },
        { type: 'desk', col: 1, row: 5 },
        { type: 'desk', col: 4, row: 5 },
        { type: 'desk', col: 7, row: 5 },
        { type: 'desk', col: 10, row: 5 },
        { type: 'monitor', col: 2, row: 1 },
        { type: 'monitor', col: 5, row: 1 },
      ],
    },
    {
      zoneId: 'meeting-room',
      col: 16, row: 0, width: 8, height: 8,
      decorations: [
        { type: 'meeting_table', col: 2, row: 2 },
        { type: 'meeting_table', col: 3, row: 2 },
        { type: 'meeting_table', col: 4, row: 2 },
        { type: 'meeting_table', col: 5, row: 2 },
        { type: 'meeting_table', col: 2, row: 3 },
        { type: 'meeting_table', col: 5, row: 3 },
      ],
    },
    {
      zoneId: 'break-room',
      col: 16, row: 8, width: 8, height: 4,
      decorations: [
        { type: 'sofa', col: 1, row: 1 },
        { type: 'coffee', col: 5, row: 1 },
        { type: 'plant', col: 6, row: 2 },
      ],
    },
    {
      zoneId: 'outside',
      col: 0, row: 10, width: 24, height: 6,
      decorations: [
        { type: 'plant', col: 1, row: 1 },
        { type: 'plant', col: 22, row: 1 },
      ],
    },
  ],
};

/** 游戏工作室布局（24×16 网格） */
const GAME_STUDIO_LAYOUT: SceneLayout = {
  sceneId: 'game-studio',
  cols: 24,
  rows: 16,
  theme: 'game_studio',
  zoneRects: [
    {
      zoneId: 'dev-pit',
      col: 0, row: 0, width: 14, height: 10,
      decorations: [
        { type: 'game_station', col: 1, row: 1 },
        { type: 'game_station', col: 4, row: 1 },
        { type: 'game_station', col: 7, row: 1 },
        { type: 'game_station', col: 1, row: 5 },
        { type: 'game_station', col: 4, row: 5 },
        { type: 'monitor', col: 10, row: 1 },
        { type: 'monitor', col: 10, row: 5 },
      ],
    },
    {
      zoneId: 'war-room',
      col: 14, row: 0, width: 10, height: 8,
      decorations: [
        { type: 'meeting_table', col: 2, row: 2 },
        { type: 'meeting_table', col: 3, row: 2 },
        { type: 'meeting_table', col: 4, row: 2 },
        { type: 'meeting_table', col: 5, row: 2 },
        { type: 'meeting_table', col: 6, row: 2 },
        { type: 'meeting_table', col: 2, row: 3 },
        { type: 'meeting_table', col: 6, row: 3 },
      ],
    },
    {
      zoneId: 'lounge',
      col: 14, row: 8, width: 10, height: 4,
      decorations: [
        { type: 'sofa', col: 1, row: 1 },
        { type: 'game_station', col: 5, row: 1 },
        { type: 'plant', col: 8, row: 2 },
      ],
    },
    {
      zoneId: 'spawn-outside',
      col: 0, row: 10, width: 24, height: 6,
      decorations: [
        { type: 'plant', col: 1, row: 1 },
        { type: 'plant', col: 22, row: 1 },
      ],
    },
  ],
};

const LAYOUTS: Map<string, SceneLayout> = new Map([
  ['default-office', OFFICE_LAYOUT],
  ['game-studio', GAME_STUDIO_LAYOUT],
]);

export function getSceneLayout(sceneId: string): SceneLayout | null {
  return LAYOUTS.get(sceneId) ?? null;
}

export function listSceneLayouts(): SceneLayout[] {
  return Array.from(LAYOUTS.values());
}
