import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityRoad } from '../../lib/api'
import { dedupeLine, useDispose } from './cityUtils'
import type { Vec2 } from '../../lib/projection'

/**
 * Real OSM road network as hand-inked strokes (~28k ways).
 * Sketch-map convention: major roads are TWO parallel lines (the classic
 * double-stroke cartographic convention), minor roads a single centerline,
 * rail a dashed single line. Every vertex carries a tiny seeded jitter so
 * strokes read as drawn, not plotted. All segments merge into a handful of
 * LineSegments draw calls.
 */

const DOUBLE_KINDS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
])
/** Half-gap between the two strokes of a double-inked road, meters. */
const DOUBLE_GAP_M = 5
/** Max vertex wobble for the hand-drawn feel. */
const JITTER_M = 0.8

const baseKind = (kind: string) => kind.replace(/_link$/, '')

/** rank 0 (motorway) -> 0.38, rank 9 (rail) -> 0.15 — majors ride on top. */
const yFor = (rank: number) => 0.15 + (9 - Math.min(9, Math.max(0, rank))) * (0.23 / 9)

interface BuiltRoads {
  /** single geometry per class: major (double) / minor / rail */
  geometries: { geometry: THREE.BufferGeometry; color: string; opacity: number }[]
  disposables: THREE.BufferGeometry[]
}

function offsetLine(line: readonly Vec2[], offset: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[Math.max(0, i - 1)]
    const n = line[Math.min(line.length - 1, i + 1)]
    const dx = n[0] - p[0]
    const dy = n[1] - p[1]
    const len = Math.hypot(dx, dy) || 1
    // left normal
    out.push([line[i][0] + (-dy / len) * offset, line[i][1] + (dx / len) * offset])
  }
  return out
}

function pushPolyline(
  out: number[],
  line: readonly Vec2[],
  y: number,
  rng: () => number,
  jitter: boolean,
) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const j = () => (jitter ? (rng() - 0.5) * 2 * JITTER_M : 0)
    out.push(a[0] + j(), y, -a[1] + j(), b[0] + j(), y, -b[1] + j())
  }
}

function buildRoads(roads: CityRoad[]): BuiltRoads {
  const majorVerts: number[] = []
  const minorVerts: number[] = []
  const railVerts: number[] = []

  for (let ri = 0; ri < roads.length; ri++) {
    const r = roads[ri]
    const line = dedupeLine(r.line)
    if (line.length < 2) continue
    const y = yFor(r.rank)
    const rng = mulberry32(Math.imul(ri + 1, 2654435761) >>> 0)

    if (baseKind(r.kind) === 'rail') {
      pushPolyline(railVerts, line, y, rng, true)
    } else if (DOUBLE_KINDS.has(baseKind(r.kind))) {
      pushPolyline(majorVerts, offsetLine(line, DOUBLE_GAP_M), y, rng, true)
      pushPolyline(majorVerts, offsetLine(line, -DOUBLE_GAP_M), y, rng, true)
    } else {
      pushPolyline(minorVerts, line, y, rng, true)
    }
  }

  const make = (verts: number[], color: string, opacity: number) => {
    if (!verts.length) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return { geometry, color, opacity }
  }

  const geometries = [
    make(majorVerts, PALETTE.inkSoft, 0.75),
    make(minorVerts, PALETTE.inkSoft, 0.42),
    make(railVerts, PALETTE.ink, 0.6),
  ].filter((g): g is { geometry: THREE.BufferGeometry; color: string; opacity: number } => g !== null)

  return { geometries, disposables: geometries.map((g) => g.geometry) }
}

export function RoadsLayer({ roads }: { roads: CityRoad[] }) {
  const built = useMemo(() => buildRoads(roads), [roads])
  useDispose(built.disposables)

  return (
    <group>
      {built.geometries.map((g, i) => (
        <lineSegments key={i} geometry={g.geometry}>
          <lineBasicMaterial color={g.color} transparent opacity={g.opacity} />
        </lineSegments>
      ))}
    </group>
  )
}
