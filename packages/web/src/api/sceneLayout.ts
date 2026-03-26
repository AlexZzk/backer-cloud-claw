/**
 * Scene 2D 布局类型（与 packages/channel-http/src/space-runtime/layout.ts 镜像）
 */

export type ZoneDecorationType =
  | 'desk'
  | 'meeting_table'
  | 'sofa'
  | 'plant'
  | 'coffee'
  | 'monitor'
  | 'game_station'

export interface ZoneDecoration {
  type: ZoneDecorationType
  col: number
  row: number
}

export interface ZoneRect {
  zoneId: string
  col: number
  row: number
  width: number
  height: number
  decorations?: ZoneDecoration[]
}

export interface SceneLayout {
  sceneId: string
  cols: number
  rows: number
  theme: 'office' | 'game_studio'
  zoneRects: ZoneRect[]
}
