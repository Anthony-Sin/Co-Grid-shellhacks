import { useMemo } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { PALETTE } from '../lib/palette'
import type { Vec2 } from '../lib/projection'
import { polygonShape, ribbonShape } from './shapeUtils'
import { ToonBuilding } from './ToonBuilding'
import { LabelChip } from '../ui/components/LabelChip'
import { generateDevCity } from './devCityLayout'
import type { DevTree } from './devCityLayout'

/**
 * TEMPORARY placeholder scene — a deterministic seeded pastel city used to
 * verify the toon look before real `city_<scene>.json` data lands.
 * Delete this file (and devCityLayout.ts) once the real scene renderer exists.
 */

function FlatPatch({ points, y, color }: { points: Vec2[]; y: number; color: string }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(polygonShape(points)), [points])
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <meshStandardMaterial color={color} flatShading roughness={1} metalness={0} />
    </mesh>
  )
}

function FlatRibbon({
  line,
  width,
  y,
  color,
}: {
  line: Vec2[]
  width: number
  y: number
  color: string
}) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(ribbonShape(line, width)), [line, width])
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <meshStandardMaterial color={color} flatShading roughness={1} metalness={0} />
    </mesh>
  )
}

function TreeBlob({ tree }: { tree: DevTree }) {
  const [x, y] = tree.position
  return (
    <group position={[x, 0, -y]}>
      <mesh castShadow position={[0, tree.trunkH / 2, 0]}>
        <cylinderGeometry args={[tree.crownR * 0.14, tree.crownR * 0.22, tree.trunkH, 6]} />
        <meshStandardMaterial color={PALETTE.park.trunk} flatShading roughness={1} />
      </mesh>
      <mesh castShadow position={[0, tree.trunkH + tree.crownR * 0.7, 0]} scale={[1, 0.82, 1]}>
        <icosahedronGeometry args={[tree.crownR, 0]} />
        <meshStandardMaterial color={tree.color} flatShading roughness={1} />
      </mesh>
    </group>
  )
}

export function DevPreviewScene({ seed, showLabels = true }: { seed: string; showLabels?: boolean }) {
  const city = useMemo(() => generateDevCity(seed), [seed])

  return (
    <group>
      {/* water: darker underlay gives the flat river a subtle inked edge */}
      {city.water.map((w, i) => (
        <group key={`w-${i}`}>
          <FlatRibbon line={w.line} width={w.width + 28} y={0.015} color={PALETTE.water.edge} />
          <FlatRibbon line={w.line} width={w.width} y={0.02} color={PALETTE.water.surface} />
        </group>
      ))}

      <FlatPatch points={city.parkPolygon} y={0.012} color={PALETTE.park.light} />

      {/* roads render slightly above water => instant "bridges" */}
      {city.roads.map((r, i) => (
        <FlatRibbon key={`r-${i}`} line={r.line} width={r.width} y={0.03} color={PALETTE.road.surface} />
      ))}

      {city.buildings.map((b) => (
        <ToonBuilding key={b.id} footprint={b.footprint} height={b.height} color={b.color} />
      ))}

      {city.trees.map((t) => (
        <TreeBlob key={t.id} tree={t} />
      ))}

      {/* floating label chips (screen-space via drei Html) — gated by the
          layers.labels toggle like the real scene's LabelChips */}
      {showLabels && city.labels.map((l) => (
        <Html
          key={l.id}
          position={[l.position[0], 110, -l.position[1]]}
          center
          zIndexRange={[30, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <LabelChip text={l.text} />
        </Html>
      ))}
    </group>
  )
}
