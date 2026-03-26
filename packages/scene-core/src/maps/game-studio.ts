/**
 * 游戏工作室地图定义
 *
 * 布局（26×18 tile）：
 * ┌─────────────────┬───────────────────┐
 * │   DEV PIT       │   WAR ROOM        │
 * │ [游戏机][游戏机] │ [会议桌]          │
 * ├─────────────────┴───────────────────┤
 * │          LOUNGE                     │
 * │  [沙发][游戏机]                     │
 * ├─────────────────────────────────────┤
 * │  SPAWN OUTSIDE (离线区)             │
 * └─────────────────────────────────────┘
 */

import type { MapDef, ZoneDef, DecorationItem } from '../types.js';

function makeDevPitSlots() {
  const slots = [];
  const positions = [
    [1, 1], [4, 1], [7, 1], [10, 1],
    [1, 5], [4, 5], [7, 5], [10, 5],
    [1, 9], [4, 9], [7, 9],
  ] as [number, number][];
  for (const [c, r] of positions) {
    slots.push({ slotId: `dp-${c}-${r}`, localCol: c, localRow: r, facing: 'up' as const });
  }
  return slots;
}

function makeWarRoomSlots() {
  return [
    { slotId: 'wr-1', localCol: 2, localRow: 1, facing: 'down'  as const },
    { slotId: 'wr-2', localCol: 3, localRow: 1, facing: 'down'  as const },
    { slotId: 'wr-3', localCol: 5, localRow: 1, facing: 'down'  as const },
    { slotId: 'wr-4', localCol: 6, localRow: 1, facing: 'down'  as const },
    { slotId: 'wr-5', localCol: 2, localRow: 5, facing: 'up'    as const },
    { slotId: 'wr-6', localCol: 3, localRow: 5, facing: 'up'    as const },
    { slotId: 'wr-7', localCol: 5, localRow: 5, facing: 'up'    as const },
    { slotId: 'wr-8', localCol: 6, localRow: 5, facing: 'up'    as const },
    { slotId: 'wr-9', localCol: 1, localRow: 3, facing: 'right' as const },
    { slotId: 'wr-10',localCol: 7, localRow: 3, facing: 'left'  as const },
  ];
}

function makeLoungeSlots() {
  return [
    { slotId: 'lg-1', localCol: 1, localRow: 1, facing: 'right' as const },
    { slotId: 'lg-2', localCol: 2, localRow: 1, facing: 'right' as const },
    { slotId: 'lg-3', localCol: 5, localRow: 1, facing: 'down'  as const },
    { slotId: 'lg-4', localCol: 8, localRow: 1, facing: 'left'  as const },
    { slotId: 'lg-5', localCol: 12,localRow: 1, facing: 'down'  as const },
    { slotId: 'lg-6', localCol: 15,localRow: 1, facing: 'left'  as const },
  ];
}

function makeSpawnSlots() {
  const slots = [];
  for (let c = 1; c < 25; c += 2) {
    slots.push({ slotId: `sp-${c}`, localCol: c, localRow: 1, facing: 'down' as const });
  }
  return slots;
}

const zones: ZoneDef[] = [
  {
    id: 'dev-pit',
    name: 'Dev Pit',
    type: 'work',
    rect: { col: 0, row: 0, width: 16, height: 11 },
    isPrivate: false,
    capacity: 11,
    colorTheme: 'work',
    slots: makeDevPitSlots(),
  },
  {
    id: 'war-room',
    name: 'War Room',
    type: 'meeting',
    rect: { col: 16, row: 0, width: 10, height: 11 },
    isPrivate: true,
    capacity: 10,
    colorTheme: 'meeting',
    slots: makeWarRoomSlots(),
  },
  {
    id: 'lounge',
    name: 'Lounge',
    type: 'social',
    rect: { col: 0, row: 11, width: 26, height: 5 },
    isPrivate: false,
    capacity: 8,
    colorTheme: 'social',
    slots: makeLoungeSlots(),
  },
  {
    id: 'spawn-outside',
    name: 'Spawn / Outside',
    type: 'outside',
    rect: { col: 0, row: 16, width: 26, height: 2 },
    isPrivate: false,
    capacity: 50,
    colorTheme: 'outside',
    slots: makeSpawnSlots(),
  },
];

const decorations: DecorationItem[] = [
  { type: 'game_station', col: 1,  row: 1  },
  { type: 'game_station', col: 4,  row: 1  },
  { type: 'game_station', col: 7,  row: 1  },
  { type: 'game_station', col: 10, row: 1  },
  { type: 'monitor',      col: 1,  row: 5  },
  { type: 'monitor',      col: 4,  row: 5  },
  { type: 'monitor',      col: 7,  row: 5  },
  { type: 'desk',         col: 1,  row: 1  },
  { type: 'desk',         col: 4,  row: 1  },
  { type: 'desk',         col: 7,  row: 1  },
  { type: 'desk',         col: 10, row: 1  },
  { type: 'bookshelf',    col: 13, row: 3  },
  { type: 'plant',        col: 14, row: 0  },
  { type: 'plant',        col: 14, row: 10 },
  { type: 'meeting_table', col: 19, row: 4 },
  { type: 'meeting_table', col: 20, row: 4 },
  { type: 'meeting_table', col: 21, row: 4 },
  { type: 'whiteboard',    col: 25, row: 2 },
  { type: 'sofa',          col: 1,  row: 12 },
  { type: 'game_station',  col: 6,  row: 12 },
  { type: 'game_station',  col: 10, row: 12 },
  { type: 'coffee',        col: 4,  row: 13 },
  { type: 'plant',         col: 24, row: 12 },
  { type: 'plant',         col: 0,  row: 16 },
  { type: 'plant',         col: 25, row: 16 },
];

export const GAME_STUDIO_MAP: MapDef = {
  id: 'game-studio',
  name: 'Game Studio',
  theme: 'game_studio',
  cols: 26,
  rows: 18,
  zones,
  decorations,
  version: 'v1.0',
};
