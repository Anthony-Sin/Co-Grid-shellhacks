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

/** Module scratch for the ring-pulse matrix rebuild — the useFrame
 *  closure runs every rendered frame, so nothing allocates per tick. */
const _QI = new THREE.Quaternion()
const _mat = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _scl = new THREE.Vector3()

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

/**
 * All planned yards render as FIVE instanced meshes total — pad,
 * transformer row, accent roof, fence rails, pulse rings — instead of
 * ~11 meshes per site (~330 draw calls at ~30 sites). The silhouette is
 * identical: every part keeps its size/offset/material, per-yard utility
 * color travels via instanceColor on the accent parts, and the pulse
 * rings all shared the same clock phase anyway so one useFrame scales
 * every ring in sync.
 */
export function PlannedStations({ projects }: { projects: readonly SceneProject[] }) {
  /** Flat site list: one entry per (project, point) — world transform is
   *  (x, z=-y) like the rest of the grid layer. */
  const sites = useMemo(
    () =>
      projects.flatMap((p) =>
        p.points.map(([x, y]) => ({ x, y, color: utilityColor(p.utility) })),
      ),
    [projects],
  )

  const padGeo = useMemo(() => new THREE.BoxGeometry(28, 1.2, 28), [])
  const boxGeo = useMemo(() => new THREE.BoxGeometry(2.2, 3.2, 4.2), [])
  const roofGeo = useMemo(() => new THREE.BoxGeometry(16, 0.9, 5.4), [])
  /** One rail shape serves all four sides — the E/W rails are the N/S
   *  rail rotated 90° in the instance matrix. */
  const railGeo = useMemo(() => new THREE.BoxGeometry(32, 1.8, 0.4), [])
  /** Ring baked flat so instance matrices stay translation*scale only. */
  const ringGeo = useMemo(() => {
    const g = new THREE.RingGeometry(34, 34 * 1.16, 48)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const padMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PAD_COLOR, roughness: 1, flatShading: true }),
    [],
  )
  const boxMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: TRANSFORMER_COLOR, roughness: 0.9, flatShading: true }),
    [],
  )
  /** Accent parts (roof + rails) are utility-colored per site, so their
   *  materials stay white and carry the hue in instanceColor. */
  const accentMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, flatShading: true }),
    [],
  )
  const railMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }),
    [],
  )
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  // args-passed objects aren't auto-disposed by r3f
  useDispose([padGeo, boxGeo, roofGeo, railGeo, ringGeo, padMat, boxMat, accentMat, railMat, ringMat])

  const padRef = useRef<THREE.InstancedMesh>(null)
  const boxRef = useRef<THREE.InstancedMesh>(null)
  const roofRef = useRef<THREE.InstancedMesh>(null)
  const railRef = useRef<THREE.InstancedMesh>(null)
  const ringRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const qSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const one = new THREE.Vector3(1, 1, 1)
    const pos = new THREE.Vector3()
    const c = new THREE.Color()
    const pads = padRef.current
    const roofs = roofRef.current
    const rings = ringRef.current
    const boxes = boxRef.current
    const rails = railRef.current
    sites.forEach((s, i) => {
      const cz = -s.y
      if (pads) {
        pos.set(s.x, 0.6, cz)
        pads.setMatrixAt(i, m.compose(pos, q.identity(), one))
      }
      if (roofs) {
        pos.set(s.x, 5, cz - 5.5)
        roofs.setMatrixAt(i, m.compose(pos, q.identity(), one))
        roofs.setColorAt(i, c.set(s.color))
      }
      if (rings) {
        pos.set(s.x, 1.1, cz)
        rings.setMatrixAt(i, m.compose(pos, q.identity(), one))
        rings.setColorAt(i, c.set(s.color))
      }
      if (boxes) {
        for (let k = 0; k < 4; k++) {
          const [sx, sz] = SLOTS[k]
          pos.set(s.x + sx, 2.8, cz + sz)
          boxes.setMatrixAt(i * 4 + k, m.compose(pos, q.identity(), one))
        }
      }
      if (rails) {
        const base = i * 4
        // N/S rails span X; E/W reuse the same geometry rotated 90°
        pos.set(s.x, 0.9, cz - 16)
        rails.setMatrixAt(base, m.compose(pos, q.identity(), one))
        pos.set(s.x, 0.9, cz + 16)
        rails.setMatrixAt(base + 1, m.compose(pos, q.identity(), one))
        pos.set(s.x - 16, 0.9, cz)
        rails.setMatrixAt(base + 2, m.compose(pos, qSide, one))
        pos.set(s.x + 16, 0.9, cz)
        rails.setMatrixAt(base + 3, m.compose(pos, qSide, one))
        rails.setColorAt(i, c.set(s.color))
      }
    })
    if (pads) pads.count = sites.length
    if (boxes) boxes.count = sites.length * 4
    if (roofs) roofs.count = sites.length
    if (rails) rails.count = sites.length * 4
    if (rings) rings.count = sites.length
    for (const mesh of [pads, boxes, roofs, rails, rings]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [sites])

  /** One pulse driver for every ring — all compounds shared a single
   *  clock phase already, so sync scaling is visually identical to the
   *  old per-site PulseRing meshes. */
  useFrame(({ clock }) => {
    const rings = ringRef.current
    if (!rings || rings.count === 0) return
    const t = (clock.elapsedTime % 2.4) / 2.4
    const s = 1 + t * 0.7
    ringMat.opacity = 0.55 * (1 - t)
    _scl.set(s, s, s)
    sites.forEach((site, i) => {
      _pos.set(site.x, 1.1, -site.y)
      rings.setMatrixAt(i, _mat.compose(_pos, _QI, _scl))
    })
    rings.instanceMatrix.needsUpdate = true
  })

  if (sites.length === 0) return null
  return (
    <group>
      <instancedMesh
        ref={padRef}
        args={[padGeo, padMat, Math.max(1, sites.length)]}
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={boxRef}
        args={[boxGeo, boxMat, Math.max(1, sites.length * 4)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={roofRef}
        args={[roofGeo, accentMat, Math.max(1, sites.length)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={railRef}
        args={[railGeo, railMat, Math.max(1, sites.length * 4)]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={ringRef}
        args={[ringGeo, ringMat, Math.max(1, sites.length)]}
        frustumCulled={false}
      />
    </group>
  )
}
