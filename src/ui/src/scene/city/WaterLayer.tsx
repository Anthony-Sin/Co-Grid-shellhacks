import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import { mulberry32 } from '../../lib/prng'
import type { CityPolygon } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose } from './cityUtils'

/**
 * Rivers, coastline, canals, lakes — real OSM water polygons.
 * Sketch treatment: a faint cool-gray wash fill (one merged ShapeGeometry)
 * plus a jittered ink shoreline stroke around every ring — the pencil-coast
 * convention. Two draw calls, no color (color is reserved for the data layer).
 */
export function WaterLayer({ water }: { water: CityPolygon[] }) {
  const built = useMemo(() => {
    const shapes: THREE.Shape[] = []
    const shore: number[] = []
    const river: number[] = []
    water.forEach((w, wi) => {
      const rng = mulberry32(Math.imul(wi + 1, 40503) >>> 0)
      const j = () => (rng() - 0.5) * 1.1
      // Open river polylines (statewide scene) — ink stroke, no fill.
      if (w.line && w.line.length > 1) {
        const y = 0.16
        for (let i = 0; i < w.line.length - 1; i++) {
          const a = w.line[i]
          const b = w.line[i + 1]
          river.push(a[0] + j(), y, -a[1] + j(), b[0] + j(), y, -b[1] + j())
        }
        return
      }
      const ring = w.polygon ? cleanRing(w.polygon) : null
      if (!ring) return
      shapes.push(polygonShape(ring))
      const y = 0.16
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        shore.push(a[0] + j(), y, -a[1] + j(), b[0] + j(), y, -b[1] + j())
      }
    })
    if (!shapes.length && !river.length)
      return { fill: null, shore: null, river: null, disposables: [] }

    const disposables: THREE.BufferGeometry[] = []
    let fill: THREE.ShapeGeometry | null = null
    if (shapes.length) {
      fill = new THREE.ShapeGeometry(shapes)
      fill.rotateX(-Math.PI / 2) // +y north -> -z world
      fill.deleteAttribute('uv')
      fill.translate(0, 0.12, 0)
      disposables.push(fill)
    }

    const toGeo = (verts: number[]) => {
      if (!verts.length) return null
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      disposables.push(g)
      return g
    }
    return {
      fill,
      shore: toGeo(shore),
      river: toGeo(river),
      disposables,
    }
  }, [water])
  useDispose(built.disposables)

  return (
    <group>
      {built.fill ? (
        <mesh geometry={built.fill} receiveShadow>
          <meshStandardMaterial
            color={PALETTE.water.surface}
            flatShading
            roughness={1}
            metalness={0}
            transparent
            opacity={0.75}
          />
        </mesh>
      ) : null}
      {built.shore ? (
        <lineSegments geometry={built.shore}>
          <lineBasicMaterial color={PALETTE.inkSoft} transparent opacity={0.5} />
        </lineSegments>
      ) : null}
      {built.river ? (
        <lineSegments geometry={built.river}>
          <lineBasicMaterial color={PALETTE.water.edge} transparent opacity={0.85} />
        </lineSegments>
      ) : null}
    </group>
  )
}
