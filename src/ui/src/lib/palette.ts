/**
 * Central palette for the CO-GRID stylized map.
 * Aesthetic: monochrome "sketch the city" — warm paper background,
 * semi-transparent white building faces with dark sketch edges, grayscale
 * water/parks/roads. COLOR is reserved for the data layer: planned project
 * geometries (utility colors) and coordination zones (tier colors).
 */
export const PALETTE = {
  /** Paper / sky background; the CSS grain texture uses the same tone */
  paper: '#E8E4DA',
  /** Shadow-catcher ground tone (only shadows show through) */
  ground: '#E1DCCB',

  building: {
    /** Translucent whites — faces barely tint the paper beneath them */
    grays: ['#FFFFFF', '#F8F6EF', '#F4F1E8'] as const,
    warm: ['#F6F3EB', '#EFEBE0'] as const,
  },

  park: {
    /** Grayscale green-space washes (a hair darker/lighter than paper) */
    deep: '#CBC8BB',
    light: '#DCD8CB',
    canopy: '#83837A',
    trunk: '#6E6A5E',
  },

  water: {
    /** Muted map blue — real water fill (not just ink), still quiet
     *  enough not to fight the tier-colored data layer */
    surface: '#A8C6D8',
    edge: '#54748A',
  },

  road: {
    surface: '#57534A',
    edge: '#83898F',
    /** Colored accents for highlighted routes (planned corridors, etc.) */
    accentAmber: '#D9A441',
    accentClay: '#C97B4A',
  },

  /** Sketch ink: warm near-black for outlines, strokes, primary text */
  ink: '#231F18',
  /** Softer ink for secondary strokes (roads, shorelines) */
  inkSoft: '#4B463C',

  /** Flat "web map" basemap (mapStyle='flat') — the clean Google/OSM
   *  read: solid land fill, real blue water, soft green parks, neutral
   *  road strokes. Deliberately muted so the utility-colored data layer
   *  stays the hero. Water reuses PALETTE.water.surface (#A8C6D8). */
  flat: {
    /** Land fill inside the state bounds — warm paper-adjacent tan */
    land: '#EDE7D9',
    /** Soft real greens for green-space fills */
    parkLight: '#D3E2C5',
    parkDeep: '#B8D0A4',
    /** Neutral road strokes: light minors ("streets"), slate majors */
    roadMajor: '#A6ABB2',
    roadMinor: '#F7F5EE',
    rail: '#9C968A',
    /** Wide soft halo under the state border ink (paper-tone casing) */
    borderHalo: '#F7F4EC',
  },

  /** Floating label chips */
  chipBg: 'rgba(30, 30, 30, 0.85)',
  chipText: '#F5F2EA',
} as const

/** Coordination tier id — IMMUTABLE semantics per docs/DATA_SCHEMA.md §5 */
export type Tier = 1 | 2 | 3 | 4

/** Tier colors — IMMUTABLE per challenge spec */
export const TIER_COLORS: Record<Tier, string> = {
  1: '#E4572E', // red-orange — touching / crossing
  2: '#F3A712', // amber — <1.6km shared ROW
  3: '#3E92CC', // blue — <8km shared logistics
  4: '#8E7CC3', // purple — <40km shared crews
}

/** Tier metadata for legend + filter UI (order matters: most valuable first) */
export const TIERS = [
  { tier: 1, color: TIER_COLORS[1], label: 'Touching', hint: 'crossing — must coordinate outages' },
  { tier: 2, color: TIER_COLORS[2], label: '<1.6km shared ROW', hint: 'share land / right-of-way' },
  { tier: 3, color: TIER_COLORS[3], label: '<8km logistics', hint: 'laydown yards, deliveries' },
  { tier: 4, color: TIER_COLORS[4], label: '<40km crews', hint: 'crews, cranes, contractors' },
] as const
