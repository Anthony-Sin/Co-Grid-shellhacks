/**
 * Central palette for the CO-GRID stylized map.
 * Aesthetic: hand-drawn / toon — warm paper background, pastel flat-shaded
 * extruded buildings with ink outlines, blobby low-poly trees, flat blue
 * water, muted road ribbons, floating dark label chips.
 */
export const PALETTE = {
  /** Paper / sky background; fog should match this for a seamless sheet look */
  paper: '#E8E4DA',
  /** Ground plane — a hair darker than the sky so the map reads as a sheet */
  ground: '#E1DCCB',

  building: {
    grays: ['#C9CDD3', '#B8BDC6', '#D8DCE2'] as const,
    warm: ['#C9A38B', '#B28E77'] as const,
  },

  park: {
    deep: '#7FB069',
    light: '#A8C686',
    canopy: '#6D9E5B',
    trunk: '#7A5C42',
  },

  water: {
    surface: '#4A7FA5',
    edge: '#3D6E94',
  },

  road: {
    surface: '#9AA0A8',
    edge: '#83898F',
    /** Colored accents for highlighted routes (planned corridors, etc.) */
    accentAmber: '#D9A441',
    accentClay: '#C97B4A',
  },

  /** Ink: outlines, borders, primary text */
  ink: '#2B2B2B',

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
