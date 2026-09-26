import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityPolygon } from '../../lib/api'
import type { Vec2 } from '../../lib/projection'
import { CORE_RADIUS_SQ, cleanRing, pointInRing, ringArea, ringCentroid, useDispose } from './cityUtils'

/**
 * Blobby low-poly trees scattered inside real OSM green polygons —
 * ONE InstancedMesh for the whole scene (canopies only, trunks skipped
 * for perf; the squashed icosphere reads as a planted blob from above).
 *
 * Deterministic: positions come from mulberry32 seeded by polygon index,
 * rejection-sampled inside each polygon's bbox (max 40 tries/point).
 * Scoped to the 13 km core — the raw estimate (~15k) is scaled down
 * proportionally per polygon so the global cap ~2.8k still spreads trees
 * across every qualifying park instead of draining them into the first.
 */

const ELIGIBLE_KINDS = new Set([
  'wood',
  'forest',
  'park',
  'nature_reserve',
  'meadow',
  'grass',
  'cemetery',
])
const MAX_TREES = 2800
const M2_PER_TREE = 2500
const MAX_TRIES = 40
const CANOPY = new THREE.Color(PALETTE.park.canopy)

interface BuiltTrees {
  mesh: THREE.InstancedMesh | null
  disposables: { dispose(): void }[]
}

function buildTrees(parks: CityPolygon[]): BuiltTrees {
  // 1) eligible polygons whose centroid falls inside the 13 km core
  const plots: { ring: Vec2[]; area: number; bbox: [number, number, number, number] }[] = []
  for (const p of parks) {
    if (!ELIGIBLE_KINDS.has(p.kind)) continue
    const ring = cleanRing(p.polygon, 4)
    if (!ring) continue
    const [cx, cy] = ringCentroid(ring)
    if (cx * cx + cy * cy >= CORE_RADIUS_SQ) continue

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const pt of ring) {
      if (pt[0] < minX) minX = pt[0]
      if (pt[1] < minY) minY = pt[1]
      if (pt[0] > maxX) maxX = pt[0]
      if (pt[1] > maxY) maxY = pt[1]
    }
    plots.push({ ring, area: ringArea(ring), bbox: [minX, minY, maxX, maxY] })
  }
  if (!plots.length) return { mesh: null, disposables: [] }

  // 2) proportional density so the global cap distributes over all plots
  const desired = plots.map((p) => p.area / M2_PER_TREE)
  const totalDesired = desired.reduce((a, b) => a + b, 0)
  const scale = Math.min(1, MAX_TREES / Math.max(1, totalDesired))

  // 3) rejection-sample each polygon (bbox + even-odd test, 40 tries max)
  const spots: { x: number; y: number; r: number; rot: number; h: number; s: number; l: number }[] = []
  plots.forEach((plot, i) => {
    const n = Math.floor(desired[i] * scale)
    if (n <= 0) return
    const rng = mulberry32(0x9e3779b9 ^ Math.imul(i + 1, 2654435761))
    const [minX, minY, maxX, maxY] = plot.bbox
    for (let t = 0; t < n; t++) {
      for (let tries = 0; tries < MAX_TRIES; tries++) {
        const x = minX + rng() * (maxX - minX)
        const y = minY + rng() * (maxY - minY)
        if (!pointInRing(x, y, plot.ring)) continue
        spots.push({
          x,
          y,
          r: 6 + rng() * 3, // crown radius 6–9 m
          rot: rng() * Math.PI * 2,
          h: rng() * 0.05 - 0.025, // hue jitter
          s: rng() * 0.1 - 0.05, // saturation jitter
          l: rng() * 0.08 - 0.04, // lightness jitter
        })
        break // placed — move to next tree
      }
    }
  })
  if (!spots.length) return { mesh: null, disposables: [] }

  // 4) bake the InstancedMesh
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', // per-instance colors carry the canopy green
    flatShading: true,
    roughness: 1,
    metalness: 0,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
  mesh.castShadow = true
  // instance positions span the whole core — the icosphere's own bounds
  // would wrongly cull it, so opt out of frustum culling.
  mesh.frustumCulled = false

  const m4 = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const col = new THREE.Color()
  spots.forEach((t, i) => {
    quat.setFromAxisAngle(up, t.rot)
    pos.set(t.x, 3 + t.r * 0.8, -t.y) // sits on ground, slight implied trunk
    scl.set(t.r, t.r * 0.82, t.r)
    m4.compose(pos, quat, scl)
    mesh.setMatrixAt(i, m4)
    col.copy(CANOPY).offsetHSL(t.h, t.s, t.l)
    mesh.setColorAt(i, col)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  return { mesh, disposables: [mesh, geo, mat] }
}

export function TreesLayer({ parks }: { parks: CityPolygon[] }) {
  const built = useMemo(() => buildTrees(parks), [parks])
  useDispose(built.disposables)

  if (!built.mesh) return null
  return <primitive object={built.mesh} />
}
