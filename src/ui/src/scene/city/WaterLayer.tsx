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
    water.forEach((w, wi) => {
      const ring = cleanRing(w.polygon)
      if (!ring) return
      shapes.push(polygonShape(ring))
      const rng = mulberry32(Math.imul(wi + 1, 40503) >>> 0)
      const j = () => (rng() - 0.5) * 1.1
      const y = 0.16
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        shore.push(a[0] + j(), y, -a[1] + j(), b[0] + j(), y, -b[1] + j())
      }
    })
    if (!shapes.length) return { fill: null, shore: null, disposables: [] }

    const fill = new THREE.ShapeGeometry(shapes)
    fill.rotateX(-Math.PI / 2) // +y north -> -z world
    fill.deleteAttribute('uv')
    fill.translate(0, 0.12, 0)

    let shoreGeo: THREE.BufferGeometry | null = null
    if (shore.length) {
      shoreGeo = new THREE.BufferGeometry()
      shoreGeo.setAttribute('position', new THREE.Float32BufferAttribute(shore, 3))
    }
    const disposables: THREE.BufferGeometry[] = [fill]
    if (shoreGeo) disposables.push(shoreGeo)
    return { fill, shore: shoreGeo, disposables }
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
    </group>
  )
}
