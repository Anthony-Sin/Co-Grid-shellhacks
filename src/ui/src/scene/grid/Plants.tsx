/**
 * Power plants (basemap existing_power_plant + projects kind=plant).
 *
 * Procedural compound at the plant's Point:
 *   - main block ~40x25x20m (silhouette #8A8F98)
 *   - signature element by fuel: NUC/WAT/unknown -> tapered cooling tower
 *     (#C9CDD3 ~35m); combustible fuels (NG, coal, oil, biomass...) ->
 *     slender ~48m stack; SUN -> low tilted panel rows
 *   - 1-2 small transformer boxes
 *   - PLANNED plants additionally get a utility-color accent stripe band
 *
 * Compounds render as instanced meshes — one InstancedMesh per part type
 * (block / tower / stack / solar rows / transformer boxes / accent band)
 * instead of ~5 meshes per plant, so ~17 sites cost 6 draw calls instead
 * of ~75. Per-plant utility color travels via instanceColor on the band.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useDispose } from '../city/cityUtils'
import type { ScenePlant, SceneProject } from './gridData'
import { utilityColor } from './gridData'

const BLOCK_COLOR = '#8A8F98'
const TOWER_COLOR = '#C9CDD3'
const STACK_COLOR = '#B8BDC6'
const BOX_COLOR = '#5B6770'
const PANEL_COLOR = '#6E7680'

/** fuels that read as a smokestack silhouette rather than a cooling tower */
const STACK_FUELS = new Set(['NG', 'DFO', 'BIT', 'SUB', 'PC', 'RC', 'WDS', 'BLQ', 'LFG', 'OG'])
/** fuels that get BOTH a cooling tower and a secondary stack */
const TOWER_FUELS = new Set(['NUC'])

/** local rotation for the solar panel rows (tilted toward the sun) */
const SOLAR_TILT = -0.32
const SOLAR_ROW_Z = [-12, 0, 12] as const

interface PlantSpec {
  x: number
  y: number
  fuel: string | null
  /** utility accent color (planned plants only) */
  accent?: string
}

/* ------------------------------------------------------------------ */

/**
 * Instanced plant compounds. Every part keeps the exact size/offset/
 * rotation of the old per-mesh JSX compound — the compound group at
 * (x, 0, -y) is folded into each instance matrix, so a part at local
 * offset (lx, ly, lz) lands at world (x + lx, ly, -y + lz).
 */
function PlantField({ specs }: { specs: readonly PlantSpec[] }) {
  const blockGeo = useMemo(() => new THREE.BoxGeometry(40, 25, 20), [])
  const towerGeo = useMemo(() => new THREE.CylinderGeometry(5.5, 8, 35, 10), [])
  const stackGeo = useMemo(() => new THREE.CylinderGeometry(2.2, 3.4, 48, 7), [])
  const panelGeo = useMemo(() => new THREE.BoxGeometry(46, 1.2, 9), [])
  const boxGeo = useMemo(() => new THREE.BoxGeometry(2, 3, 4), [])
  const bandGeo = useMemo(() => new THREE.BoxGeometry(41, 2.4, 21), [])
  const blockMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: BLOCK_COLOR, roughness: 1, flatShading: true }),
    [],
  )
  const towerMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: TOWER_COLOR, roughness: 1, flatShading: true }),
    [],
  )
  const stackMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: STACK_COLOR, roughness: 1, flatShading: true }),
    [],
  )
  const panelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PANEL_COLOR, roughness: 0.9, flatShading: true }),
    [],
  )
  const boxMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: BOX_COLOR, roughness: 0.9, flatShading: true }),
    [],
  )
  /** accent band material stays white — the filed utility color arrives
   *  per instance via setColorAt */
  const bandMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }),
    [],
  )
  useDispose([blockGeo, towerGeo, stackGeo, panelGeo, boxGeo, bandGeo,
    blockMat, towerMat, stackMat, panelMat, boxMat, bandMat])

  /** Part instances derived from the spec list — same bucketing rules as
   *  the old compound JSX (solar rows OR stack OR cooling tower, NUC
   *  gets tower + stack, transformer boxes always). */
  const parts = useMemo(() => {
    const towers: PlantSpec[] = []
    const stacks: { x: number; y: number; lx: number; ly: number; lz: number }[] = []
    const solars: PlantSpec[] = []
    const accents: { x: number; y: number; color: string }[] = []
    for (const s of specs) {
      const fuel = (s.fuel ?? '').toUpperCase()
      if (fuel === 'SUN') solars.push(s)
      else if (STACK_FUELS.has(fuel)) stacks.push({ x: s.x, y: s.y, lx: 14, ly: 24, lz: 4 })
      else if (fuel !== 'WAT') towers.push(s) // hydro reads as the block alone
      if (TOWER_FUELS.has(fuel)) stacks.push({ x: s.x, y: s.y, lx: 15, ly: 20, lz: -5 })
      if (s.accent) accents.push({ x: s.x, y: s.y, color: s.accent })
    }
    return { towers, stacks, solars, accents }
  }, [specs])

  const blockRef = useRef<THREE.InstancedMesh>(null)
  const towerRef = useRef<THREE.InstancedMesh>(null)
  const stackRef = useRef<THREE.InstancedMesh>(null)
  const panelRef = useRef<THREE.InstancedMesh>(null)
  const boxRef = useRef<THREE.InstancedMesh>(null)
  const bandRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), SOLAR_TILT)
    const one = new THREE.Vector3(1, 1, 1)
    const pos = new THREE.Vector3()
    const c = new THREE.Color()
    const block = blockRef.current
    const tower = towerRef.current
    const stack = stackRef.current
    const panel = panelRef.current
    const box = boxRef.current
    const band = bandRef.current
    if (block) {
      specs.forEach((s, i) => {
        pos.set(s.x, 12.5, -s.y)
        block.setMatrixAt(i, m.compose(pos, q.identity(), one))
      })
      block.count = specs.length
    }
    if (tower) {
      parts.towers.forEach((s, i) => {
        pos.set(s.x - 14, 17.5, -s.y + 5)
        tower.setMatrixAt(i, m.compose(pos, q.identity(), one))
      })
      tower.count = parts.towers.length
    }
    if (stack) {
      parts.stacks.forEach((s, i) => {
        pos.set(s.x + s.lx, s.ly, -s.y + s.lz)
        stack.setMatrixAt(i, m.compose(pos, q.identity(), one))
      })
      stack.count = parts.stacks.length
    }
    if (panel) {
      let i = 0
      for (const s of parts.solars) {
        for (const z of SOLAR_ROW_Z) {
          pos.set(s.x, 3, -s.y + z)
          panel.setMatrixAt(i++, m.compose(pos, qTilt, one))
        }
      }
      panel.count = i
    }
    if (box) {
      specs.forEach((s, i) => {
        pos.set(s.x + 12, 2.5, -s.y + 13)
        box.setMatrixAt(i * 2, m.compose(pos, q.identity(), one))
        pos.set(s.x + 16.5, 2.5, -s.y + 13)
        box.setMatrixAt(i * 2 + 1, m.compose(pos, q.identity(), one))
      })
      box.count = specs.length * 2
    }
    if (band) {
      parts.accents.forEach((s, i) => {
        pos.set(s.x, 21, -s.y)
        band.setMatrixAt(i, m.compose(pos, q.identity(), one))
        band.setColorAt(i, c.set(s.color))
      })
      band.count = parts.accents.length
      if (band.instanceColor) band.instanceColor.needsUpdate = true
    }
    for (const mesh of [block, tower, stack, panel, box, band]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [specs, parts])

  if (specs.length === 0) return null
  return (
    <group>
      <instancedMesh
        ref={blockRef}
        args={[blockGeo, blockMat, Math.max(1, specs.length)]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={towerRef}
        args={[towerGeo, towerMat, Math.max(1, parts.towers.length)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={stackRef}
        args={[stackGeo, stackMat, Math.max(1, parts.stacks.length)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={panelRef}
        args={[panelGeo, panelMat, Math.max(1, parts.solars.length * 3)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={boxRef}
        args={[boxGeo, boxMat, Math.max(1, specs.length * 2)]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={bandRef}
        args={[bandGeo, bandMat, Math.max(1, parts.accents.length)]}
        frustumCulled={false}
      />
    </group>
  )
}

/* ------------------------------------------------------------------ */

export function ExistingPlants({ plants }: { plants: readonly ScenePlant[] }) {
  const specs = useMemo<PlantSpec[]>(
    () => plants.map((p) => ({ x: p.x, y: p.y, fuel: p.fuel })),
    [plants],
  )
  return <PlantField specs={specs} />
}

/**
 * Infer a plant silhouette from the filing language (no fake data — just
 * picks which real compound shape to draw): combustion-turbine /
 * combined-cycle wording -> stack; nuclear/solar keywords -> tower/panels.
 */
function inferredFuel(p: SceneProject): string | null {
  const text = `${p.name} ${p.notes}`.toLowerCase()
  if (text.includes('nuclear') || text.includes('vogtle')) return 'NUC'
  if (text.includes('solar') || text.includes('pv')) return 'SUN'
  if (
    text.includes('combined-cycle') ||
    text.includes('combined cycle') ||
    text.includes('combustion') ||
    text.includes('ngcc') ||
    text.includes('ct ') ||
    text.includes(' ct') ||
    text.includes('gas')
  )
    return 'NG'
  return null
}

export function PlannedPlants({ projects }: { projects: readonly SceneProject[] }) {
  const specs = useMemo<PlantSpec[]>(
    () =>
      projects.flatMap((p) =>
        p.points.map((pt) => ({
          x: pt[0],
          y: pt[1],
          fuel: inferredFuel(p),
          accent: utilityColor(p.utility),
        })),
      ),
    [projects],
  )
  return <PlantField specs={specs} />
}
