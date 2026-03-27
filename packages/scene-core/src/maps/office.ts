/**
 * BCC Office Map — 36×18 tile grid
 *
 * Gather-style layout:
 * ┌────────────────────────────┬──────────┐
 * │  WORKSTATIONS (26×14)      │ MEETING  │
 * │  4 rows × 8 cols = 32 desks│ ROOM     │
 * │                            │ (10×10)  │
 * │                            │ 10 seats │
 * │                            ├──────────┤
 * │                            │  BREAK   │
 * │                            │  ROOM    │
 * │                            │ (10×4)   │
 * ├────────────────────────────┴──────────┤
 * │  OUTSIDE / LOBBY  (36×4)              │
 * └───────────────────────────────────────┘
 */

import type { MapDef, ZoneDef, DecorationItem } from '../types.js';

// ── Slot helpers ─────────────────────────────────────────────────────────────

/** Workstations: 4 rows × 8 cols = 32 desk slots */
function makeWorkstationSlots() {
  const slots = [];
  const rows = [2, 5, 8, 11];
  const cols = [1, 4, 7, 10, 13, 16, 19, 22];
  let i = 0;
  for (const r of rows) {
    for (const c of cols) {
      slots.push({ slotId: `ws-${i}`, localCol: c, localRow: r, facing: 'up' as const });
      i++;
    }
  }
  return slots;
}

/** Meeting room: 10 seats around a large conference table */
function makeMeetingSlots() {
  return [
    // Top row (row 2, facing toward table)
    { slotId: 'mt-1', localCol: 2, localRow: 2, facing: 'down' as const },
    { slotId: 'mt-2', localCol: 3, localRow: 2, facing: 'down' as const },
    { slotId: 'mt-3', localCol: 4, localRow: 2, facing: 'down' as const },
    { slotId: 'mt-4', localCol: 5, localRow: 2, facing: 'down' as const },
    { slotId: 'mt-5', localCol: 6, localRow: 2, facing: 'down' as const },
    // Bottom row (row 7, facing toward table)
    { slotId: 'mt-6',  localCol: 2, localRow: 7, facing: 'up' as const },
    { slotId: 'mt-7',  localCol: 3, localRow: 7, facing: 'up' as const },
    { slotId: 'mt-8',  localCol: 4, localRow: 7, facing: 'up' as const },
    { slotId: 'mt-9',  localCol: 5, localRow: 7, facing: 'up' as const },
    { slotId: 'mt-10', localCol: 6, localRow: 7, facing: 'up' as const },
  ];
}

/** Break room: 5 social spots around sofas & coffee */
function makeBreakSlots() {
  return [
    { slotId: 'br-1', localCol: 1, localRow: 2, facing: 'right' as const },
    { slotId: 'br-2', localCol: 2, localRow: 2, facing: 'right' as const },
    { slotId: 'br-3', localCol: 4, localRow: 2, facing: 'down'  as const },
    { slotId: 'br-4', localCol: 6, localRow: 2, facing: 'left'  as const },
    { slotId: 'br-5', localCol: 7, localRow: 2, facing: 'left'  as const },
  ];
}

/** Outside/lobby: spread across full width */
function makeOutsideSlots() {
  const slots = [];
  for (let c = 1; c < 36; c += 2) {
    slots.push({ slotId: `out-${c}`, localCol: c, localRow: 2, facing: 'down' as const });
  }
  return slots;
}

// ── Zone definitions ──────────────────────────────────────────────────────────

const zones: ZoneDef[] = [
  {
    id: 'workstations',
    name: 'Workstations',
    type: 'work',
    rect: { col: 0, row: 0, width: 26, height: 14 },
    isPrivate: false,
    capacity: 32,
    colorTheme: 'work',
    slots: makeWorkstationSlots(),
  },
  {
    id: 'meeting-room',
    name: 'Meeting Room',
    type: 'meeting',
    rect: { col: 26, row: 0, width: 10, height: 10 },
    isPrivate: true,
    capacity: 10,
    colorTheme: 'meeting',
    slots: makeMeetingSlots(),
  },
  {
    id: 'break-room',
    name: 'Break Room',
    type: 'social',
    rect: { col: 26, row: 10, width: 10, height: 4 },
    isPrivate: false,
    capacity: 5,
    colorTheme: 'social',
    slots: makeBreakSlots(),
  },
  {
    id: 'outside',
    name: 'Outside',
    type: 'outside',
    rect: { col: 0, row: 14, width: 36, height: 4 },
    isPrivate: false,
    capacity: 50,
    colorTheme: 'outside',
    slots: makeOutsideSlots(),
  },
];

// ── Decorations ───────────────────────────────────────────────────────────────

const decorations: DecorationItem[] = [
  // Workstation monitors — row above each desk row
  { type: 'monitor', col: 1,  row: 1 },
  { type: 'monitor', col: 4,  row: 1 },
  { type: 'monitor', col: 7,  row: 1 },
  { type: 'monitor', col: 10, row: 1 },
  { type: 'monitor', col: 13, row: 1 },
  { type: 'monitor', col: 16, row: 1 },
  { type: 'monitor', col: 19, row: 1 },
  { type: 'monitor', col: 22, row: 1 },
  { type: 'monitor', col: 1,  row: 4 },
  { type: 'monitor', col: 4,  row: 4 },
  { type: 'monitor', col: 7,  row: 4 },
  { type: 'monitor', col: 10, row: 4 },
  { type: 'monitor', col: 13, row: 4 },
  { type: 'monitor', col: 16, row: 4 },
  { type: 'monitor', col: 19, row: 4 },
  { type: 'monitor', col: 22, row: 4 },
  // Bookshelves — right wall of workstations
  { type: 'bookshelf', col: 24, row: 2  },
  { type: 'bookshelf', col: 24, row: 5  },
  { type: 'bookshelf', col: 24, row: 8  },
  { type: 'bookshelf', col: 24, row: 11 },
  // Plants — workstation corners
  { type: 'plant', col: 0,  row: 0  },
  { type: 'plant', col: 0,  row: 6  },
  { type: 'plant', col: 0,  row: 12 },
  { type: 'plant', col: 25, row: 0  },
  { type: 'plant', col: 25, row: 12 },
  // Meeting room — large conference table (two rows)
  { type: 'meeting_table', col: 28, row: 3 },
  { type: 'meeting_table', col: 29, row: 3 },
  { type: 'meeting_table', col: 30, row: 3 },
  { type: 'meeting_table', col: 31, row: 3 },
  { type: 'meeting_table', col: 32, row: 3 },
  { type: 'meeting_table', col: 28, row: 4 },
  { type: 'meeting_table', col: 29, row: 4 },
  { type: 'meeting_table', col: 30, row: 4 },
  { type: 'meeting_table', col: 31, row: 4 },
  { type: 'meeting_table', col: 32, row: 4 },
  { type: 'whiteboard', col: 35, row: 1 },
  { type: 'plant',      col: 26, row: 8 },
  { type: 'plant',      col: 35, row: 9 },
  // Break room
  { type: 'sofa',        col: 27, row: 11 },
  { type: 'sofa',        col: 28, row: 11 },
  { type: 'coffee',      col: 31, row: 11 },
  { type: 'water_cooler', col: 33, row: 12 },
  { type: 'plant',       col: 34, row: 12 },
  // Outside / lobby
  { type: 'plant', col: 0,  row: 14 },
  { type: 'plant', col: 35, row: 14 },
  { type: 'plant', col: 17, row: 16 },
];

// ── Map definition ────────────────────────────────────────────────────────────

export const OFFICE_MAP: MapDef = {
  id: 'default-office',
  name: 'BCC Office',
  theme: 'office',
  cols: 36,
  rows: 18,
  zones,
  decorations,
  version: 'v2.0',
};
