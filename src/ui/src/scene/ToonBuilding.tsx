import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import { PALETTE } from '../lib/palette'
import type { Vec2 } from '../lib/projection'
import { polygonShape } from './shapeUtils'

interface ToonBuildingProps {
  /** Closed footprint ring in local meters [x, y] (y = north -> -z in world) */
  footprint: Vec2[]
  /** Extrusion height in meters */
  height: number
  /** Flat-shaded fill color */
  color: string
  edgeColor?: string
}

/**
 * A stylized building: footprint polygon extruded vertically, flat-shaded,
 * with thin ink outlines. The extrude shape's XY plane is rotated onto the
 * ground (XZ) so `depth` becomes world +y height.
 * Geometry disposal on unmount is handled by R3F (no manual useEffect —
 * keeps StrictMode double-effects safe).
 */
export function ToonBuilding({ footprint, height, color, edgeColor = PALETTE.ink }: ToonBuildingProps) {
  const geometry = useMemo(
    () => new THREE.ExtrudeGeometry(polygonShape(footprint), { depth: height, bevelEnabled: false }),
    [footprint, height],
  )

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} flatShading roughness={1} metalness={0} />
      <Edges threshold={15} color={edgeColor} />
    </mesh>
  )
}
