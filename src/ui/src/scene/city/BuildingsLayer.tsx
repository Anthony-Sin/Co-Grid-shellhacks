import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityBuilding } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose } from './cityUtils'

/**
 * ~70k real OSM footprints, extruded and merged into a handful of draw calls.
 *
 * Strategy: assign every building to one of ~7 color buckets (3 grays,
 * 2 warm pastels + local civic/industrial tints), build one merged
 * BufferGeometry per bucket, render one flat-shaded mesh each.
 * No per-building meshes, no per-building <Edges> — that would be ~70k
 * draw calls. Instead a single merged LineSegments draws the roofline
 * outline only for tall (>= 25 m) or named buildings — cheap skyline ink.
 *
 * Perf notes:
 * - `uv` attributes are dropped before merging (saves ~25% of buffer
 *   memory; materials carry no maps).
 * - ExtrudeGeometry is non-indexed, so the merge is a straight concat.
 * - Bucket choice is a deterministic prng seeded by the building's OSM id
 *   plus a kind bias, so the mosaic is stable frame-to-frame and
 *   reproduces across reloads.
 */

// Bucket indices into BUCKET_COLORS — translucent whites (sketch faces)
const GRAY = 0 // +0..2
const WARM = 3 // +0..1
const CIVIC = 5
const INDUSTRIAL = 6

const BUCKET_COLORS = [
  PALETTE.building.grays[0],
  PALETTE.building.grays[1],
  PALETTE.building.grays[2],
  PALETTE.building.warm[0],
  PALETTE.building.warm[1],
  '#F1EEE5', // civic/church — same paper family, a touch brighter
  '#ECE9DF', // industrial — warm gray, still monochrome
] as const

/** Sketch strokes: extend each segment past its ends (ArcGIS extensionLength). */
const EDGE_OVERSHOOT_M = 1.6
/** Max endpoint jitter — pencil wobble. Scaled by segment length below. */
const EDGE_JITTER_M = 0.55
/** Fraction of ring vertices that also get a vertical wall stroke. */
const WALL_STROKE_P = 0.4

/** Deterministic color bucket per building: kind bias + id-seeded roll. */
function bucketFor(b: CityBuilding): number {
  const rng = mulberry32(b.id >>> 0)
  const roll = rng()
  const gray = () => GRAY + Math.floor(rng() * 3)
  const warm = () => WARM + Math.floor(rng() * 2)

  switch (b.kind) {
    case 'residential':
      return roll < 0.8 ? gray() : warm()
    case 'commercial':
      return roll < 0.5 ? warm() : gray()
    case 'civic':
      return roll < 0.7 ? CIVIC : gray()
    case 'church':
      return roll < 0.6 ? CIVIC : warm()
    case 'industrial':
      return roll < 0.75 ? INDUSTRIAL : gray()
    default:
      return roll < 0.88 ? gray() : warm()
  }
}

/**
 * Push one jittered, overshot segment. Endpoints are perturbed independently
 * — perfect joins would look plotted, not drawn (AGENTS: hand-drawn look).
 */
function pushStroke(
  out: number[],
  rng: () => number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-3) return
  const j = Math.min(EDGE_JITTER_M, len * 0.08)
  const over = Math.min(EDGE_OVERSHOOT_M, len * 0.22) / len
  const jx = () => (rng() - 0.5) * 2 * j
  const jz = () => (rng() - 0.5) * 2 * j
  out.push(
    ax - dx * over + jx(),
    ay - dy * over + (rng() - 0.5) * j,
    az - dz * over + jz(),
    bx + dx * over + jx(),
    by + dy * over + (rng() - 0.5) * j,
    bz + dz * over + jz(),
  )
}

interface BuiltBuildings {
  meshes: { geometry: THREE.BufferGeometry; color: string }[]
  /** merged ink strokes for EVERY building: top ring + sparse wall strokes */
  ink: THREE.BufferGeometry | null
  disposables: { dispose(): void }[]
}

function buildBuildings(buildings: CityBuilding[]): BuiltBuildings {
  const buckets: THREE.BufferGeometry[][] = BUCKET_COLORS.map(() => [])
  const inkVerts: number[] = []

  for (const b of buildings) {
    const ring = cleanRing(b.footprint)
    if (!ring) continue
    const h = Math.max(1.5, b.height || 8)

    const geo = new THREE.ExtrudeGeometry(polygonShape(ring), {
      depth: h,
      bevelEnabled: false,
    })
    // Extrude runs along +Z; rotateX(-90°) stands it up on +Y and maps
    // footprint +y (north) to -z (north = up on screen).
    geo.rotateX(-Math.PI / 2)
    geo.deleteAttribute('uv')
    buckets[bucketFor(b)].push(geo)

    // Sketch ink: roofline ring for every building + a few vertical wall
    // strokes — the "sketch edges" look. A manual outline pass is far cheaper
    // than ~68k EdgesGeometry runs (each would re-run earcut + face angles).
    const rng = mulberry32((b.id >>> 0) ^ 0x5bd1e995)
    const top = h + 0.25 // hair above the roof plane to avoid z-fighting
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const c = ring[(i + 1) % ring.length]
      pushStroke(inkVerts, rng, a[0], top, -a[1], c[0], top, -c[1])
      if (rng() < WALL_STROKE_P && h > 4) {
        const wallTop = top - 0.4
        const wallBot = top - h * (0.55 + rng() * 0.35)
        pushStroke(inkVerts, rng, a[0], wallTop, -a[1], a[0], wallBot, -a[1])
      }
    }
  }

  const disposables: { dispose(): void }[] = []
  const meshes: BuiltBuildings['meshes'] = []
  buckets.forEach((list, i) => {
    if (!list.length) return
    const merged = mergeGeometries(list, false)
    if (!merged) return
    disposables.push(merged)
    meshes.push({ geometry: merged, color: BUCKET_COLORS[i] })
  })

  let ink: THREE.BufferGeometry | null = null
  if (inkVerts.length) {
    ink = new THREE.BufferGeometry()
    ink.setAttribute('position', new THREE.Float32BufferAttribute(inkVerts, 3))
    disposables.push(ink)
  }

  return { meshes, ink, disposables }
}

export function BuildingsLayer({ buildings }: { buildings: CityBuilding[] }) {
  const built = useMemo(() => buildBuildings(buildings), [buildings])
  useDispose(built.disposables)

  return (
    <group>
      {built.meshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} castShadow receiveShadow>
          {/* Sketch faces: white, barely-there — like the ArcGIS sketch
              renderer's [255,255,255,0.1] fill. Shadows still land. */}
          <meshStandardMaterial
            color={m.color}
            flatShading
            roughness={1}
            metalness={0}
            transparent
            opacity={0.2}
          />
        </mesh>
      ))}
      {built.ink ? (
        <>
          <lineSegments geometry={built.ink}>
            <lineBasicMaterial color={PALETTE.ink} transparent opacity={0.8} />
          </lineSegments>
          {/* Second pass, offset a whisker: pencil double-stroke. */}
          <lineSegments geometry={built.ink} position={[0.9, 0.35, 0.55]}>
            <lineBasicMaterial color={PALETTE.ink} transparent opacity={0.2} />
          </lineSegments>
        </>
      ) : null}
    </group>
  )
}
