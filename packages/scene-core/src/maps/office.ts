/**
 * 默认办公室地图定义
 *
 * 布局（26×18 tile）：
 * ┌─────────────────────────────────────┐
 * │         WORKSTATIONS (大区)          │
 * │  [桌1][桌2][桌3][桌4][桌5][桌6]      │
 * │  [桌7][桌8][桌9]...                  │
 * ├──────────────┬──────────────────────┤
 * │  BREAK ROOM  │    MEETING ROOM      │
 * │  [沙发][咖啡]│  [会议桌]            │
 * ├──────────────┴──────────────────────┤
 * │  OUTSIDE (离线区)                    │
 * └─────────────────────────────────────┘
 */

import type { MapDef, ZoneDef, DecorationItem } from '../types.js';

// 工位槽位定义（workstations 区域内，每个工位一个槽）
function makeWorkstationSlots() {
  const slots = [];
  // 3行 × 5列 = 15个工位，每个工位间隔3格
  const cols = [1, 4, 7, 10, 13];
  const rows = [1, 4, 7];
  for (const r of rows) {
    for (const c of cols) {
      slots.push({
        slotId: `ws-${c}-${r}`,
        localCol: c,
        localRow: r,
        facing: 'up' as const,
      });
    }
  }
  return slots;
}

// 会议室槽位（围绕会议桌排列）
function makeMeetingSlots() {
  return [
    // 桌子上方
    { slotId: 'mt-1', localCol: 2, localRow: 1, facing: 'down' as const },
    { slotId: 'mt-2', localCol: 3, localRow: 1, facing: 'down' as const },
    { slotId: 'mt-3', localCol: 4, localRow: 1, facing: 'down' as const },
    { slotId: 'mt-4', localCol: 5, localRow: 1, facing: 'down' as const },
    // 桌子下方
    { slotId: 'mt-5', localCol: 2, localRow: 5, facing: 'up' as const },
    { slotId: 'mt-6', localCol: 3, localRow: 5, facing: 'up' as const },
    { slotId: 'mt-7', localCol: 4, localRow: 5, facing: 'up' as const },
    { slotId: 'mt-8', localCol: 5, localRow: 5, facing: 'up' as const },
    // 桌子左右
    { slotId: 'mt-9',  localCol: 1, localRow: 3, facing: 'right' as const },
    { slotId: 'mt-10', localCol: 6, localRow: 3, facing: 'left'  as const },
  ];
}

// 休息区槽位
function makeBreakSlots() {
  return [
    { slotId: 'br-1', localCol: 1, localRow: 1, facing: 'right' as const },
    { slotId: 'br-2', localCol: 2, localRow: 1, facing: 'right' as const },
    { slotId: 'br-3', localCol: 1, localRow: 3, facing: 'down'  as const },
    { slotId: 'br-4', localCol: 2, localRow: 3, facing: 'down'  as const },
    { slotId: 'br-5', localCol: 4, localRow: 2, facing: 'left'  as const },
  ];
}

// 室外（离线区）槽位
function makeOutsideSlots() {
  const slots = [];
  for (let c = 1; c < 25; c += 2) {
    slots.push({
      slotId: `out-${c}`,
      localCol: c,
      localRow: 1,
      facing: 'down' as const,
    });
  }
  return slots;
}

const zones: ZoneDef[] = [
  {
    id: 'workstations',
    name: 'Workstations',
    type: 'work',
    rect: { col: 0, row: 0, width: 26, height: 11 },
    isPrivate: false,
    capacity: 15,
    colorTheme: 'work',
    slots: makeWorkstationSlots(),
  },
  {
    id: 'break-room',
    name: 'Break Room',
    type: 'social',
    rect: { col: 0, row: 11, width: 9, height: 5 },
    isPrivate: false,
    capacity: 8,
    colorTheme: 'social',
    slots: makeBreakSlots(),
  },
  {
    id: 'meeting-room',
    name: 'Meeting Room',
    type: 'meeting',
    rect: { col: 9, row: 11, width: 17, height: 5 },
    isPrivate: true,
    capacity: 10,
    colorTheme: 'meeting',
    slots: makeMeetingSlots(),
  },
  {
    id: 'outside',
    name: 'Outside',
    type: 'outside',
    rect: { col: 0, row: 16, width: 26, height: 2 },
    isPrivate: false,
    capacity: 50,
    colorTheme: 'outside',
    slots: makeOutsideSlots(),
  },
];

const decorations: DecorationItem[] = [
  // 工位区装饰
  { type: 'monitor',      col: 1,  row: 0  },
  { type: 'monitor',      col: 4,  row: 0  },
  { type: 'monitor',      col: 7,  row: 0  },
  { type: 'monitor',      col: 10, row: 0  },
  { type: 'monitor',      col: 13, row: 0  },
  { type: 'monitor',      col: 1,  row: 3  },
  { type: 'monitor',      col: 4,  row: 3  },
  { type: 'monitor',      col: 7,  row: 3  },
  { type: 'desk',         col: 1,  row: 1  },
  { type: 'desk',         col: 4,  row: 1  },
  { type: 'desk',         col: 7,  row: 1  },
  { type: 'desk',         col: 10, row: 1  },
  { type: 'desk',         col: 13, row: 1  },
  { type: 'desk',         col: 1,  row: 4  },
  { type: 'desk',         col: 4,  row: 4  },
  { type: 'desk',         col: 7,  row: 4  },
  { type: 'desk',         col: 10, row: 4  },
  { type: 'bookshelf',    col: 16, row: 2  },
  { type: 'bookshelf',    col: 18, row: 2  },
  { type: 'plant',        col: 24, row: 0  },
  { type: 'plant',        col: 24, row: 5  },
  // 休息区装饰
  { type: 'sofa',         col: 1,  row: 12 },
  { type: 'coffee',       col: 4,  row: 12 },
  { type: 'water_cooler', col: 6,  row: 13 },
  { type: 'plant',        col: 7,  row: 14 },
  // 会议室装饰
  { type: 'meeting_table', col: 11, row: 13 },
  { type: 'meeting_table', col: 12, row: 13 },
  { type: 'meeting_table', col: 13, row: 13 },
  { type: 'meeting_table', col: 14, row: 13 },
  { type: 'whiteboard',    col: 24, row: 12 },
  { type: 'plant',         col: 25, row: 14 },
  // 室外装饰
  { type: 'plant',         col: 0,  row: 16 },
  { type: 'plant',         col: 25, row: 16 },
];

export const OFFICE_MAP: MapDef = {
  id: 'default-office',
  name: 'Default Office',
  theme: 'office',
  cols: 26,
  rows: 18,
  zones,
  decorations,
  version: 'v1.0',
};
