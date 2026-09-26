/**
 * Procedural low-poly lattice transmission tower (~39m tall).
 * Composed entirely from cylinder/box primitives merged into ONE
 * BufferGeometry so hundreds can render as a single InstancedMesh.
 * Dark ink/steel, flatShading — matches the hand-drawn toon look.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Anchor } from './gridData'

export const PYLON_COLOR = '#45454B' // dark steel / ink
const PYLON_HEIGHT = 39

/** Cylinder stretched from `a` to `b` (radius r0 at a -> r1 at b). */
function strut(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const geo = new THREE.CylinderGeometry(r1, r0, len, 5)
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  )
  geo.applyQuaternion(q)
  const mid = a.clone().add(b).multiplyScalar(0.5)
  geo.translate(mid.x, mid.y, mid.z)
  return geo
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(x, y, z)
  return geo
}

let cached: THREE.BufferGeometry | null = null

/**
 * Tower silhouette:
 *   0-24m  : 4 legs tapering 4.5m -> 1.6m half-span + waist brace boxes
 *   24-30m : narrow neck (4 struts -> 1.1m half-span)
 *   30.5m  : long lower cross-arm (19m, carries the conductors)
 *   34.5m  : shorter upper cross-arm (14m)
 *   36-39m : pointed ground-wire tip
 */
export function pylonGeometry(): THREE.BufferGeometry {
  if (cached) return cached
  const parts: THREE.BufferGeometry[] = []
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  const BASE = 4.5
  const WAIST = 1.6
  const NECK = 1.1
  const corners = (s: number, y: number) => [
    v(-s, y, -s),
    v(s, y, -s),
    v(s, y, s),
    v(-s, y, s),
  ]

  // tapered body: base -> waist -> neck
  const base = corners(BASE, 0)
  const waist = corners(WAIST, 24)
  const neck = corners(NECK, 30)
  for (let i = 0; i < 4; i++) {
    parts.push(strut(base[i], waist[i], 0.42, 0.34))
    parts.push(strut(waist[i], neck[i], 0.3, 0.26))
    // horizontal braces on each face (two levels) — hints at lattice
    const j = (i + 1) % 4
    parts.push(strut(base[i].clone().lerp(waist[i], 0.5), base[j].clone().lerp(waist[j], 0.5), 0.14, 0.14))
    parts.push(strut(waist[i].clone().lerp(neck[i], 0.5), waist[j].clone().lerp(neck[j], 0.5), 0.12, 0.12))
  }
  // waist platform
  parts.push(box(WAIST * 2 + 0.8, 1.2, WAIST * 2 + 0.8, 0, 24, 0))
  // cross-arms run along +/-X (perpendicular to travel at yaw=0)
  parts.push(box(19, 1.5, 1.5, 0, 30.8, 0))
  parts.push(box(14, 1.3, 1.3, 0, 34.6, 0))
  // arm end caps (insulator hints)
  for (const sx of [-1, 1]) {
    parts.push(box(0.9, 2.2, 0.9, sx * 8.6, 29.4, 0))
    parts.push(box(0.8, 1.8, 0.8, sx * 6.4, 33.6, 0))
  }
  // pointed tip
  const tip = new THREE.CylinderGeometry(0.05, 0.42, 4.5, 5)
  tip.translate(0, 36.6, 0)
  parts.push(tip)

  cached = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return cached
}

/** Single composed tower (used sparingly — instanced path is preferred). */
export function Pylon({
  position,
  yaw = 0,
  scale = 1,
  color = PYLON_COLOR,
}: {
  position: [number, number, number]
  yaw?: number
  scale?: number
  color?: string
}) {
  const geo = useMemo(pylonGeometry, [])
  return (
    <mesh
      geometry={geo}
      position={position}
      rotation={[0, yaw, 0]}
      scale={scale}
      castShadow
      dispose={null}
    >
      <meshStandardMaterial color={color} flatShading roughness={0.85} metalness={0.15} />
    </mesh>
  )
}

/**
 * Instanced towers. `dispose={null}` keeps the shared cached geometry alive
 * across GridOverlay remounts (component is keyed per scene).
 */
export function PylonInstances({
  anchors,
  color = PYLON_COLOR,
  scale = 1,
}: {
  anchors: readonly Anchor[]
  color?: string
  scale?: number
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(pylonGeometry, [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: 0.85,
        metalness: 0.15,
      }),
    [color],
  )

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3(scale, scale, scale)
    anchors.forEach((a, i) => {
      q.setFromAxisAngle(up, a.yaw)
      pos.set(a.x, 0, -a.y)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
    })
    mesh.count = anchors.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [anchors, scale])

  if (anchors.length === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[geo, material, Math.max(1, anchors.length)]}
      castShadow
      frustumCulled={false}
      dispose={null}
    />
  )
}

export { PYLON_HEIGHT }
