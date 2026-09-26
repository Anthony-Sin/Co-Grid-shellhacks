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
    if (!p.polygon) continue
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

export function ParksLayer({ parks, flat = false }: { parks: CityPolygon[]; flat?: boolean }) {
  const built = useMemo(() => buildParks(parks), [parks])
  useDispose(built.disposables)

  // Flat mode: real soft greens at near-solid opacity over the land fill,
  // unlit (meshBasicMaterial) so the palette hex is what renders.
  // Sketch mode: lit grayscale washes that let the paper show through.
  const lightColor = flat ? PALETTE.flat.parkLight : PALETTE.park.light
  const deepColor = flat ? PALETTE.flat.parkDeep : PALETTE.park.deep
  const opacity = flat ? 0.95 : 0.6

  return (
    <group>
      {built.light ? (
        <mesh geometry={built.light} receiveShadow={!flat}>
          {flat ? (
            <meshBasicMaterial color={lightColor} transparent opacity={opacity} />
          ) : (
            <meshStandardMaterial
              color={lightColor}
              flatShading
              roughness={1}
              metalness={0}
              transparent
              opacity={opacity}
            />
          )}
        </mesh>
      ) : null}
      {built.deep ? (
        <mesh geometry={built.deep} receiveShadow={!flat}>
          {flat ? (
            <meshBasicMaterial color={deepColor} transparent opacity={opacity} />
          ) : (
            <meshStandardMaterial
              color={deepColor}
              flatShading
              roughness={1}
              metalness={0}
              transparent
              opacity={opacity}
            />
          )}
        </mesh>
      ) : null}
    </group>
  )
}
