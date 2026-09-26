import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import type { CityRoad } from '../../lib/api'
import { ribbonShape } from '../shapeUtils'
import { dedupeLine, useDispose } from './cityUtils'

/**
 * Real OSM road network as flat ribbons (~28k ways).
 * All ribbons of the same kind are baked into ONE ShapeGeometry — a single
 * draw call per kind (~13). Road `kind`↔`rank` is 1:1 in the pipeline, so
 * each kind gets a fixed y: major roads float slightly higher, which reads
 * as overpasses where they cross minor ones (and water — instant bridges).
 */

const WIDTHS: Record<string, number> = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 8,
  tertiary: 6,
  residential: 4,
  service: 2.5,
  unclassified: 4,
  rail: 3,
}
const DEFAULT_WIDTH = 4
const RAIL_INK = '#3A3A3A'

/** `motorway_link` etc. inherit the parent kind's width/color. */
const baseKind = (kind: string) => kind.replace(/_link$/, '')

const widthFor = (kind: string) => WIDTHS[baseKind(kind)] ?? DEFAULT_WIDTH

/** rank 0 (motorway) -> 0.35, rank 9 (rail) -> 0.15 — majors ride on top. */
const yFor = (rank: number) => 0.15 + (9 - Math.min(9, Math.max(0, rank))) * (0.2 / 9)

interface BuiltRoads {
  meshes: { geometry: THREE.BufferGeometry; color: string }[]
  disposables: THREE.BufferGeometry[]
}

function buildRoads(roads: CityRoad[]): BuiltRoads {
  const byKind = new Map<string, { shapes: THREE.Shape[]; rank: number }>()

  for (const r of roads) {
    const line = dedupeLine(r.line)
    if (line.length < 2) continue
    let entry = byKind.get(r.kind)
    if (!entry) {
      entry = { shapes: [], rank: r.rank }
      byKind.set(r.kind, entry)
    }
    entry.shapes.push(ribbonShape(line, widthFor(r.kind)))
  }

  const meshes: BuiltRoads['meshes'] = []
  const disposables: THREE.BufferGeometry[] = []
  for (const [kind, entry] of byKind) {
    const geo = new THREE.ShapeGeometry(entry.shapes)
    // Shape XY is local meters (+y north); rotate flat so north is -z/up-screen,
    // then lift to this kind's rank height.
    geo.rotateX(-Math.PI / 2)
    geo.deleteAttribute('uv')
    geo.translate(0, yFor(entry.rank), 0)
    disposables.push(geo)
    meshes.push({
      geometry: geo,
      color: baseKind(kind) === 'rail' ? RAIL_INK : PALETTE.road.surface,
    })
  }
  return { meshes, disposables }
}

export function RoadsLayer({ roads }: { roads: CityRoad[] }) {
  const built = useMemo(() => buildRoads(roads), [roads])
  useDispose(built.disposables)

  return (
    <group>
      {built.meshes.map((m, i) => (
        <mesh key={i} geometry={m.geometry} receiveShadow>
          <meshStandardMaterial color={m.color} flatShading roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}
