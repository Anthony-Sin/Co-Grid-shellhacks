import { useMemo } from 'react'
import * as THREE from 'three'
import { PALETTE } from '../../lib/palette'
import type { CityPolygon } from '../../lib/api'
import { polygonShape } from '../shapeUtils'
import { cleanRing, useDispose } from './cityUtils'

/**
 * Rivers, coastline, canals, lakes, ponds — all real OSM water polygons
 * merged into a single flat fill (one ShapeGeometry, one draw call).
 * Sits at y ≈ 0.12: above park fills, below roads so roads crossing it
 * read as bridges.
 */
export function WaterLayer({ water }: { water: CityPolygon[] }) {
  const geometry = useMemo(() => {
    const shapes: THREE.Shape[] = []
    for (const w of water) {
      const ring = cleanRing(w.polygon)
      if (ring) shapes.push(polygonShape(ring))
    }
    if (!shapes.length) return null
    const geo = new THREE.ShapeGeometry(shapes)
    geo.rotateX(-Math.PI / 2) // +y north -> -z world
    geo.deleteAttribute('uv')
    geo.translate(0, 0.12, 0)
    return geo
  }, [water])
  useDispose(geometry)

  if (!geometry) return null
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={PALETTE.water.surface} flatShading roughness={1} metalness={0} />
    </mesh>
  )
}
