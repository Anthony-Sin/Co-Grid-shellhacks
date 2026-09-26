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

// Bucket indices into BUCKET_COLORS
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
  '#A9B8C9', // civic/church tint — cool slate next to the neutral grays
  '#C4A887', // industrial tint — dusty clay between warm and ink
] as const

/** Buildings that get a roofline ink outline: skyline + landmarks only. */
const ROOFLINE_MIN_HEIGHT = 25

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

interface BuiltBuildings {
  meshes: { geometry: THREE.BufferGeometry; color: string }[]
  /** merged roofline segments for tall/named buildings, or null */
  rooflines: THREE.BufferGeometry | null
  disposables: { dispose(): void }[]
}

function buildBuildings(buildings: CityBuilding[]): BuiltBuildings {
  const buckets: THREE.BufferGeometry[][] = BUCKET_COLORS.map(() => [])
  const roofVerts: number[] = []

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

    // Skyline ink: top-perimeter segments for tall or named buildings.
    // A manual ring outline is far cheaper than ~3k EdgesGeometry passes
    // (which would re-run earcut + face-angle math per building) and looks
    // identical for vertical extrusions under flat shading.
    if (h >= ROOFLINE_MIN_HEIGHT || b.name) {
      const top = h + 0.2 // hair above the roof plane to avoid z-fighting
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const c = ring[(i + 1) % ring.length]
        roofVerts.push(a[0], top, -a[1], c[0], top, -c[1])
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

  let rooflines: THREE.BufferGeometry | null = null
  if (roofVerts.length) {
    rooflines = new THREE.BufferGeometry()
    rooflines.setAttribute('position', new THREE.Float32BufferAttribute(roofVerts, 3))
    disposables.push(rooflines)
  }

  return { meshes, rooflines, disposables }
}

export function BuildingsLayer({ buildings }: { buildings: CityBuilding[] }) {
  const built = useMemo(() => buildBuildings(buildings), [buildings])
  useDispose(built.disposables)

  return (
    <group>
      {built.meshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} castShadow receiveShadow>
          <meshStandardMaterial color={m.color} flatShading roughness={1} metalness={0} />
        </mesh>
      ))}
      {built.rooflines ? (
        <lineSegments geometry={built.rooflines}>
          <lineBasicMaterial color={PALETTE.ink} transparent opacity={0.55} />
        </lineSegments>
      ) : null}
    </group>
  )
}
