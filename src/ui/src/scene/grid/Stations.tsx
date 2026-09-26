/**
 * Substations.
 *
 *  EXISTING (basemap existing_substation — hundreds region-wide, capped to
 *   the ~36km scene window by the filter):
 *   - 24x24m gravel pad, instanced
 *   - 3-6 transformer boxes (2x3x4m, #5B6770), instanced, seeded layout so
 *     each yard has stable variation
 *   - low fence outline, one merged constant-width segment set
 *
 *  PLANNED (projects kind substation|upgrade):
 *   - same compound slightly bigger + utility-colored accent roof slab
 *   - soft pulsing ground ring to draw the eye
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { rngFromString } from '../../lib/prng'
import { useDispose } from '../city/cityUtils'
import type { SceneProject, SceneSub } from './gridData'
import { utilityColor } from './gridData'

const PAD_SIZE = 24
const PAD_COLOR = '#A8A293' // gravel
const TRANSFORMER_COLOR = '#5B6770'
const FENCE_COLOR = '#2B2B2B'

/** transformer slots inside a pad (x, z offsets in meters) */
const SLOTS: readonly [number, number][] = [
  [-6.5, -5.5],
  [0, -5.5],
  [6.5, -5.5],
  [-6.5, 5.5],
  [0, 5.5],
  [6.5, 5.5],
]

type V3 = [number, number, number]

/* ------------------------------------------------------------------ */
/* existing substations (instanced)                                    */
/* ------------------------------------------------------------------ */

export function ExistingSubstations({ subs }: { subs: readonly SceneSub[] }) {
  const padGeo = useMemo(() => new THREE.BoxGeometry(PAD_SIZE, 1, PAD_SIZE), [])
  const boxGeo = useMemo(() => new THREE.BoxGeometry(2, 3, 4), [])
  const padMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PAD_COLOR, roughness: 1, flatShading: true }),
    [],
  )
  const boxMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: TRANSFORMER_COLOR, roughness: 0.9, flatShading: true }),
    [],
  )
  // r3f doesn't auto-dispose objects passed via instancedMesh args —
  // without this every scene switch leaks 2 geometries + 2 materials
  useDispose([padGeo, boxGeo, padMat, boxMat])
  const padRef = useRef<THREE.InstancedMesh>(null)
  const boxRef = useRef<THREE.InstancedMesh>(null)

  /** (x, y-local, yaw) per transformer instance — seeded per substation. */
  const transformers = useMemo(() => {
    const out: { x: number; y: number; yaw: number }[] = []
    for (const s of subs) {
      const rng = rngFromString(`sub|${s.name}|${s.x.toFixed(0)}|${s.y.toFixed(0)}`)
      const n = 3 + Math.floor(rng() * 4) // 3-6 boxes
      for (let i = 0; i < n; i++) {
        const [sx, sz] = SLOTS[i % SLOTS.length]
        out.push({ x: s.x + sx, y: s.y + sz, yaw: (rng() - 0.5) * 0.5 })
      }
    }
    return out
  }, [subs])

  /** fence outlines merged into one segment list (local y -> -z) */
  const fencePts = useMemo(() => {
    const pts: V3[] = []
    const h = 1.6
    const half = 14 // 28x28 fence
    for (const s of subs) {
      const cx = s.x
      const cz = -s.y
      const c: V3[] = [
        [cx - half, h, cz - half],
        [cx + half, h, cz - half],
        [cx + half, h, cz + half],
        [cx - half, h, cz + half],
      ]
      for (let i = 0; i < 4; i++) pts.push(c[i], c[(i + 1) % 4])
    }
    return pts
  }, [subs])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const scl = new THREE.Vector3(1, 1, 1)
    const pos = new THREE.Vector3()
    const pads = padRef.current
    if (pads) {
      subs.forEach((s, i) => {
        q.identity()
        pos.set(s.x, 0.5, -s.y)
        m.compose(pos, q, scl)
        pads.setMatrixAt(i, m)
      })
      pads.count = subs.length
      pads.instanceMatrix.needsUpdate = true
      pads.computeBoundingSphere()
    }
    const boxes = boxRef.current
    if (boxes) {
      transformers.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw)
        pos.set(t.x, 2.6, -t.y)
        m.compose(pos, q, scl)
        boxes.setMatrixAt(i, m)
      })
      boxes.count = transformers.length
      boxes.instanceMatrix.needsUpdate = true
      boxes.computeBoundingSphere()
    }
  }, [subs, transformers])

  if (subs.length === 0) return null
  return (
    <group>
      <instancedMesh
        ref={padRef}
        args={[padGeo, padMat, Math.max(1, subs.length)]}
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={boxRef}
        args={[boxGeo, boxMat, Math.max(1, transformers.length)]}
        castShadow
        frustumCulled={false}
      />
      {fencePts.length > 0 && (
        <Line
          segments
          points={fencePts}
          lineWidth={1}
          color={FENCE_COLOR}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* planned substation / upgrade compounds                              */
/* ------------------------------------------------------------------ */

/** Soft pulsing ring at ground level (scale + fade loop). */
function PulseRing({ color, radius = 30 }: { color: string; radius?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = (clock.elapsedTime % 2.4) / 2.4
    const s = 1 + t * 0.7
    mesh.scale.set(s, s, s)
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = 0.55 * (1 - t)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.1, 0]}>
      <ringGeometry args={[radius, radius * 1.16, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.55}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/** One planned yard: pad + transformers + accent roof + pulse ring. */
function PlannedStationCompound({ project, at }: { project: SceneProject; at: [number, number] }) {
  const color = utilityColor(project.utility)
  return (
    <group position={[at[0], 0, -at[1]]}>
      {/* gravel pad */}
      <mesh position={[0, 0.6, 0]} receiveShadow>
        <boxGeometry args={[28, 1.2, 28]} />
        <meshStandardMaterial color={PAD_COLOR} roughness={1} flatShading />
      </mesh>
      {/* transformer boxes */}
      {SLOTS.slice(0, 4).map(([sx, sz], i) => (
        <mesh key={i} position={[sx, 2.8, sz]} castShadow>
          <boxGeometry args={[2.2, 3.2, 4.2]} />
          <meshStandardMaterial color={TRANSFORMER_COLOR} roughness={0.9} flatShading />
        </mesh>
      ))}
      {/* utility-colored accent roof slab over the transformer row */}
      <mesh position={[0, 5, -5.5]} castShadow>
        <boxGeometry args={[16, 0.9, 5.4]} />
        <meshStandardMaterial color={color} roughness={0.8} flatShading />
      </mesh>
      {/* low fence */}
      <FenceOutline half={16} height={1.8} color={color} />
      <PulseRing color={color} radius={34} />
    </group>
  )
}

/** thin rectangular outline (4 box rails) — cheap fence for planned yards */
function FenceOutline({ half, height, color }: { half: number; height: number; color: string }) {
  return (
    <group position={[0, height / 2, 0]}>
      {[
        { w: half * 2, d: 0.4, x: 0, z: -half },
        { w: half * 2, d: 0.4, x: 0, z: half },
        { w: 0.4, d: half * 2, x: -half, z: 0 },
        { w: 0.4, d: half * 2, x: half, z: 0 },
      ].map((r, i) => (
        <mesh key={i} position={[r.x, 0, r.z]}>
          <boxGeometry args={[r.w, height, r.d]} />
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

export function PlannedStations({ projects }: { projects: readonly SceneProject[] }) {
  return (
    <group>
      {projects.flatMap((p) =>
        p.points.map((pt, i) => (
          <PlannedStationCompound key={`${p.id}-${i}`} project={p} at={pt} />
        )),
      )}
    </group>
  )
}
