import { PALETTE } from '../lib/palette'
import { mulberry32, hashStringToSeed, pick, range } from '../lib/prng'
import type { Vec2 } from '../lib/projection'

/**
 * TEMPORARY dev layout generator — produces a deterministic, seeded
 * placeholder city so the toon aesthetic can be verified before real
 * `city_<scene>.json` data lands. Pure data (no three.js); safe to delete
 * together with DevPreviewScene.
 */

export interface DevBuilding {
  id: string
  footprint: Vec2[]
  height: number
  color: string
}

export interface DevRibbon {
  line: Vec2[]
  width: number
}

export interface DevTree {
  id: string
  /** local meters [x, y] */
  position: Vec2
  crownR: number
  trunkH: number
  color: string
}

export interface DevLabel {
  id: string
  text: string
  /** local meters [x, y]; rendered floating above ground */
  position: Vec2
}

export interface DevCity {
  /** Half-size of the generated city in meters */
  extent: number
  buildings: DevBuilding[]
  /** water ribbons (index 0 = main river) */
  water: DevRibbon[]
  parkPolygon: Vec2[]
  roads: DevRibbon[]
  trees: DevTree[]
  labels: DevLabel[]
}

// ---- layout constants ------------------------------------------------------
const BLOCKS = 30 // ~30x30 block grid
const PITCH = 150 // block spacing, meters
const EXTENT = (BLOCKS * PITCH) / 2 + 300

// gentle S-curve river drifting east
function riverY(x: number): number {
  return 420 * Math.sin(x / 780) + 0.12 * x
}

const PARK_CENTER: Vec2 = [720, -560]
const PARK_RX = 430
const PARK_RY = 340

const ROAD_DEFS: { line: Vec2[]; width: number }[] = [
  { line: [[-EXTENT, -300], [EXTENT, -300]], width: 30 },
  { line: [[-EXTENT, 1050], [EXTENT, 1050]], width: 24 },
  { line: [[-750, -EXTENT], [-750, EXTENT]], width: 30 },
  { line: [[1350, -EXTENT], [1350, EXTENT]], width: 24 },
  // diagonal connector
  { line: [[-EXTENT, -1900], [-700, -200], [300, 1400], [EXTENT, 2200]], width: 22 },
]

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)),
  )
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t))
}

function nearRoad(p: Vec2, margin: number): boolean {
  return ROAD_DEFS.some(({ line, width }) => {
    for (let i = 0; i < line.length - 1; i++) {
      if (distToSegment(p, line[i], line[i + 1]) < margin + width / 2) return true
    }
    return false
  })
}

function inPark(p: Vec2, margin: number): boolean {
  const dx = (p[0] - PARK_CENTER[0]) / (PARK_RX + margin)
  const dy = (p[1] - PARK_CENTER[1]) / (PARK_RY + margin)
  return dx * dx + dy * dy < 1
}

// ---- generator --------------------------------------------------------------
export function generateDevCity(seedKey: string): DevCity {
  const rng = mulberry32(hashStringToSeed(seedKey))
  const buildings: DevBuilding[] = []

  for (let gx = 0; gx < BLOCKS; gx++) {
    for (let gz = 0; gz < BLOCKS; gz++) {
      const cx = (gx - (BLOCKS - 1) / 2) * PITCH + range(rng, -22, 22)
      const cy = (gz - (BLOCKS - 1) / 2) * PITCH + range(rng, -22, 22)

      // organic gaps: some empty blocks, plus clearances for river/park/roads
      if (rng() < 0.16) continue
      if (Math.abs(cy - riverY(cx)) < 210) continue
      if (inPark([cx, cy], 40)) continue
      if (nearRoad([cx, cy], 42)) continue

      const w = range(rng, 55, 95)
      const d = range(rng, 55, 95)
      // taller toward "downtown" center
      const downtown = Math.exp(-(cx * cx + cy * cy) / (1500 * 1500))
      const height = range(rng, 8, 16) + downtown * range(rng, 30, 60)

      const color =
        rng() < 0.15
          ? pick(rng, PALETTE.building.warm)
          : pick(rng, PALETTE.building.grays)

      // slight random rotation for the hand-drawn feel
      const a = range(rng, -0.06, 0.06)
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const corner = (ox: number, oy: number): Vec2 => [
        cx + ox * cos - oy * sin,
        cy + ox * sin + oy * cos,
      ]
      const footprint: Vec2[] = [
        corner(-w / 2, -d / 2),
        corner(w / 2, -d / 2),
        corner(w / 2, d / 2),
        corner(-w / 2, d / 2),
      ]

      buildings.push({ id: `b-${gx}-${gz}`, footprint, height, color })
    }
  }

  // river centerline sampled across the city
  const riverLine: Vec2[] = []
  for (let x = -EXTENT - 200; x <= EXTENT + 200; x += 90) {
    riverLine.push([x, riverY(x)])
  }

  // park = perturbed ellipse
  const parkPolygon: Vec2[] = []
  const parkPts = 18
  for (let i = 0; i < parkPts; i++) {
    const t = (i / parkPts) * Math.PI * 2
    const k = 1 + range(rng, -0.16, 0.16)
    parkPolygon.push([
      PARK_CENTER[0] + Math.cos(t) * PARK_RX * k,
      PARK_CENTER[1] + Math.sin(t) * PARK_RY * k,
    ])
  }

  // blobby trees scattered inside the park ellipse (scaled 0.75 for margin)
  const trees: DevTree[] = []
  for (let i = 0; i < 40; i++) {
    const t = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * 0.75
    trees.push({
      id: `t-${i}`,
      position: [
        PARK_CENTER[0] + Math.cos(t) * PARK_RX * r,
        PARK_CENTER[1] + Math.sin(t) * PARK_RY * r,
      ],
      crownR: range(rng, 9, 16),
      trunkH: range(rng, 6, 11),
      color: pick(rng, [PALETTE.park.deep, PALETTE.park.light, PALETTE.park.canopy]),
    })
  }

  const labels: DevLabel[] = [
    { id: 'lbl-river', text: 'RIVER ST', position: [-260, riverY(-260) + 130] },
    { id: 'lbl-plant', text: 'PLANT McINTOSH', position: [1980, riverY(1980) + 40] },
    { id: 'lbl-park', text: 'FORSYTH PARK', position: PARK_CENTER },
  ]

  return {
    extent: EXTENT,
    buildings,
    water: [{ line: riverLine, width: 170 }],
    parkPolygon,
    roads: ROAD_DEFS,
    trees,
    labels,
  }
}
