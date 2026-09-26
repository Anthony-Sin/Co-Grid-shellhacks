import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import type { CityPolygon } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose } from './cityUtils'

/**
 * Park/green-space fills from real OSM polygons, merged into two draw calls:
 * deep green for vegetated kinds (wood/forest/wetland/scrub), light green
 * for everything else (grass, parks, cemeteries, beaches, golf courses…).
 * Deep sits a hair higher so overlapping fills don't z-fight.
 */
const DEEP_KINDS = new Set(['wood', 'forest', 'wetland', 'scrub', 'nature_reserve'])

interface BuiltParks {
  light: THREE.BufferGeometry | null
  deep: THREE.BufferGeometry | null
  disposables: THREE.BufferGeometry[]
}

function buildParks(parks: CityPolygon[]): BuiltParks {
  const lightShapes: THREE.Shape[] = []
  const deepShapes: THREE.Shape[] = []
  for (const p of parks) {
    const ring = cleanRing(p.polygon)
    if (!ring) continue
    ;(DEEP_KINDS.has(p.kind) ? deepShapes : lightShapes).push(polygonShape(ring))
  }

  const make = (shapes: THREE.Shape[], y: number): THREE.BufferGeometry | null => {
    if (!shapes.length) return null
    const geo = new THREE.ShapeGeometry(shapes)
    geo.rotateX(-Math.PI / 2)
    geo.deleteAttribute('uv')
    geo.translate(0, y, 0)
    return geo
  }

  const light = make(lightShapes, 0.1)
  const deep = make(deepShapes, 0.105)
  const disposables = [light, deep].filter((g): g is THREE.BufferGeometry => g !== null)
  return { light, deep, disposables }
}

export function ParksLayer({ parks }: { parks: CityPolygon[] }) {
  const built = useMemo(() => buildParks(parks), [parks])
  useDispose(built.disposables)

  return (
    <group>
      {built.light ? (
        <mesh geometry={built.light} receiveShadow>
          <meshStandardMaterial
            color={PALETTE.park.light}
            flatShading
            roughness={1}
            metalness={0}
            transparent
            opacity={0.6}
          />
        </mesh>
      ) : null}
      {built.deep ? (
        <mesh geometry={built.deep} receiveShadow>
          <meshStandardMaterial
            color={PALETTE.park.deep}
            flatShading
            roughness={1}
            metalness={0}
            transparent
            opacity={0.6}
          />
        </mesh>
      ) : null}
    </group>
  )
}
