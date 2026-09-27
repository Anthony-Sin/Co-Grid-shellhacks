/**
 * corridorComposite.ts — fold the Savannah + Augusta corridor artifacts
 * into the single statewide scene.
 *
 * city_state.json spans GA+SC but ships 0 buildings / 0 parks (roads,
 * water, and POIs only); the corridor artifacts carry dense local
 * extracts — buildings, parks, POIs — in LOCAL meters relative to each
 * artifact's own `center`. This hook fetches both through the shared
 * `deduped` request cache (same `city:<scene>` keys as useCity) and
 * re-projects their feature arrays into state-local meters, so one
 * merged render shows real 3D corridors inside the clean state sheet.
 *
 * Corridor roads/water are deliberately NOT composited — the state
 * artifact already carries statewide copies; duplicating them would
 * double-ink the basemap.
 *
 * Projection note: each artifact baked x = (lon-c0)·111320·cos(c1),
 * y = (lat-c1)·110540 relative to its own center [c0,c1]. Composing the
 * corridor inverse with the state forward projection is exactly affine
 * (see corridorToState) — a flat translation alone drifts by
 * cos(stateLat)/cos(corridorLat), ~300 m at corridor edges, which would
 * visibly detach footprints from zone-tint masks (computed exactly in
 * state-local meters via lonLatToLocal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { api } from '../../lib/api'
import type { CityBuilding, CityPolygon, CityPoi, CityScene, SceneId } from '../../lib/api'
import { SCENE_CENTERS, type Vec2 } from '../../lib/projection'
import { deduped } from '../../ui/hooks/useApiData'

const METERS_PER_DEG_LAT = 110540
const METERS_PER_DEG_LON_EQUATOR = 111320

/** Corridor/metro extracts to fold into the state scene. `idBias`
 * guarantees building-id uniqueness across artifacts for the seeded
 * prng buckets + ink jitter in BuildingsLayer. It MUST stay a multiple
 * of 7 — the backend's fallback height is `8 + id % 7` and
 * renderHeightM() detects that signature via `b.id % 7`, so shifting
 * the residue would wrongly treat assumed heights as filed.
 * 2.1e9 = 7·300M — multiples stay ≡0 mod 7; `>>>0` consumers wrap mod
 * 2^32 harmlessly (seeds only). */
const CORRIDORS: readonly { scene: SceneId; idBias: number }[] = [
  { scene: 'savannah', idBias: 0 },
  { scene: 'augusta', idBias: 2_100_000_000 },
  { scene: 'atlanta', idBias: 4_200_000_000 },
  { scene: 'columbia', idBias: 6_300_000_000 },
  { scene: 'charleston', idBias: 8_400_000_000 },
  { scene: 'greenville_sc', idBias: 10_500_000_000 },
  { scene: 'columbus_ga', idBias: 12_600_000_000 },
  { scene: 'athens', idBias: 14_700_000_000 },
  { scene: 'macon', idBias: 16_800_000_000 },
]

/** A corridor's artifact fetches only when the camera target comes
 * within this radius of its center — ~460k buildings is ~160 MB of
 * JSON; pulling every metro on first zoom-in would stall the map.
 * 110 km covers a corridor's own ~±15 km extent plus the adjacent view. */
const FETCH_RADIUS_M = 110_000

/** Corridor features re-projected into state-local meters. */
export interface CorridorDetail {
  buildings: CityBuilding[]
  parks: CityPolygon[]
  pois: CityPoi[]
}

interface CorridorPayload {
  scene: SceneId
  idBias: number
  data: CityScene
}

// Module-level one-shot guards — StrictMode remounts re-run effects/memos.
const warnedScenes = new Set<SceneId>()
let compositeLogged = false

/**
 * Affine remap of one corridor payload into state-local meters:
 *   x' = x·cos(s₁)/cos(c₁) + (c₀-s₀)·111320·cos(s₁)
 *   y' = y + (c₁-s₁)·110540
 * Exact compose of the artifact's own inverse projection with the state
 * projection, so composited geometry lands where the backend's state
 * build would have put it — zone masks and state roads line up.
 */
function corridorToState(payload: CorridorPayload, out: CorridorDetail): void {
  const [c0, c1] = payload.data.center
  const [s0, s1] = SCENE_CENTERS.state
  const rad = Math.PI / 180
  const cosS = Math.cos(s1 * rad)
  const ax = cosS / Math.cos(c1 * rad)
  const bx = (c0 - s0) * METERS_PER_DEG_LON_EQUATOR * cosS
  const by = (c1 - s1) * METERS_PER_DEG_LAT
  const remap = (x: number, y: number): Vec2 => [ax * x + bx, y + by]

  const { idBias } = payload
  for (const b of payload.data.buildings) {
    out.buildings.push({
      ...b,
      id: b.id + idBias,
      footprint: b.footprint.map(([x, y]) => remap(x, y)),
    })
  }
  for (const p of payload.data.parks) {
    out.parks.push({
      ...p,
      polygon: p.polygon?.map(([x, y]) => remap(x, y)),
      line: p.line?.map(([x, y]) => remap(x, y)),
    })
  }
  for (const p of payload.data.pois ?? []) {
    const [x, y] = remap(p.x, p.y)
    out.pois.push({ ...p, x, y })
  }
}

/** Each corridor's own local origin (0,0) mapped to state-local meters —
 *  the point its artifact is centered on. bx/by are exactly the affine
 *  translation corridorToState computes at (x,y)=(0,0). */
const CORRIDOR_LOCAL: ReadonlyMap<SceneId, Vec2> = new Map(
  CORRIDORS.map((c) => {
    const [c0, c1] = SCENE_CENTERS[c.scene]
    const [s0, s1] = SCENE_CENTERS.state
    return [
      c.scene,
      [
        (c0 - s0) * METERS_PER_DEG_LON_EQUATOR * Math.cos((s1 * Math.PI) / 180),
        (c1 - s1) * METERS_PER_DEG_LAT,
      ] as Vec2,
    ]
  }),
)

/**
 * Fetch + re-project corridor artifacts for the state scene — each metro
 * downloads only when the camera target comes within FETCH_RADIUS_M of
 * its center (the ~160 MB total must never pull all at once). Payloads
 * accumulate in ARRIVAL order, so a new corridor appends to the merged
 * arrays without shifting earlier indices — BuildingsLayer's incremental
 * tile cache then rebuilds only the cells the newcomer touched.
 * A failed corridor fetch warns once and retries on the next approach —
 * honest absence, never fabricated geometry.
 */
export function useCorridorDetail(enabled: boolean): CorridorDetail | null {
  const controls = useThree((s) => s.controls) as { target?: { x: number; z: number } } | null
  const [payloads, setPayloads] = useState<CorridorPayload[] | null>(null)
  const doneRef = useRef(new Set<SceneId>())
  const inflightRef = useRef(new Set<SceneId>())
  const attemptsRef = useRef(new Map<SceneId, number>())
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const fetchOne = useCallback((c: { scene: SceneId; idBias: number }) => {
    if (doneRef.current.has(c.scene) || inflightRef.current.has(c.scene)) return
    // cap retries — a failing endpoint must not refire every rendered
    // frame while the camera sits inside the radius (demand loop still
    // ticks on every pan/zoom). 3 attempts then honest absence; a page
    // reload resets the counter.
    if ((attemptsRef.current.get(c.scene) ?? 0) >= 3) return
    attemptsRef.current.set(c.scene, (attemptsRef.current.get(c.scene) ?? 0) + 1)
    inflightRef.current.add(c.scene)
    deduped(`city:${c.scene}`, () => api.city(c.scene))
      .then((data) => {
        doneRef.current.add(c.scene)
        setPayloads((prev) => [...(prev ?? []), { scene: c.scene, idBias: c.idBias, data }])
      })
      .catch((e: unknown) => {
        if (!warnedScenes.has(c.scene)) {
          warnedScenes.add(c.scene)
          console.warn(
            `[corridorComposite] /api/city/${c.scene} failed — ` +
              `compositing without it (honest absence):`,
            e instanceof Error ? e.message : e,
          )
        }
      })
      .finally(() => inflightRef.current.delete(c.scene))
  }, [])

  // Fetch every corridor whose center is within the radius of the camera
  // target. World x = local x; world -z = local north.
  const checkProximity = useCallback(() => {
    const t = controls?.target
    if (!t) return
    const tx = t.x
    const ty = -t.z
    for (const c of CORRIDORS) {
      const [cx, cy] = CORRIDOR_LOCAL.get(c.scene)!
      const dx = tx - cx
      const dy = ty - cy
      if (dx * dx + dy * dy < FETCH_RADIUS_M * FETCH_RADIUS_M) fetchOne(c)
    }
  }, [controls, fetchOne])

  // Camera moves invalidate the demand frameloop — proximity rides along.
  useFrame(() => {
    if (enabledRef.current) checkProximity()
  })
  // Gate flip (zoom prefetch / selection) — check immediately; the demand
  // loop may not have a frame queued at that moment.
  useEffect(() => {
    if (enabled) checkProximity()
  }, [enabled, checkProximity])

  return useMemo(() => {
    if (!payloads || payloads.length === 0) return null
    const out: CorridorDetail = { buildings: [], parks: [], pois: [] }
    for (const p of payloads) corridorToState(p, out)
    if (!compositeLogged) {
      compositeLogged = true
      console.debug(
        `[corridorComposite] ${payloads.map((p) => p.scene).join(' + ')} → state: ` +
          `${out.buildings.length} buildings, ${out.parks.length} parks, ` +
          `${out.pois.length} pois re-projected to state-local meters`,
      )
      ;(window as unknown as { __corridorComposited?: number }).__corridorComposited =
        out.buildings.length
    }
    return out
  }, [payloads])
}

/** Ortho zoom where corridor detail fades in/out — a hysteresis band so a
 * camera parked between the two thresholds keeps its last state instead
 * of flickering. State overview sits at zoom≈0.0022; city-scale reading
 * starts around ~0.01. Below the band ~148k extruded footprints are
 * vertex noise that still cost GPU every drawn frame. */
const ZOOM_SHOW = 0.008
const ZOOM_HIDE = 0.006

/**
 * Zoom gate for the merged corridor building meshes. Reads camera.zoom
 * inside useFrame only, flipping a boolean when a threshold is crossed —
 * setState with an unchanged value bails out, so idle frames cost ~0.
 * Hidden = meshes fully unmounted; geometries stay memoized upstream,
 * so a remount after zooming back in is cheap.
 */
export function useCorridorZoomGate(): boolean {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const invalidate = useThree((s) => s.invalidate)
  const [visible, setVisible] = useState(
    () => 'zoom' in camera && (camera as { zoom: number }).zoom >= ZOOM_SHOW,
  )
  // Debug handles for headless captures — there is no zoom URL param and
  // ?focus flights park the ortho camera beyond `far`, so verification
  // scripts set an in-range pose directly via these refs (stable objects).
  useEffect(() => {
    const w = window as unknown as {
      __cogridCamera?: unknown
      __cogridControls?: unknown
      __cogridInvalidate?: () => void
    }
    w.__cogridCamera = camera
    w.__cogridControls = controls
    w.__cogridInvalidate = invalidate
  }, [camera, controls, invalidate])
  useFrame(() => {
    const z = 'zoom' in camera ? (camera as { zoom: number }).zoom : 1
    // debug telemetry for headless captures (no zoom URL param exists)
    const dbg = window as unknown as { __cogridZoom?: number; __cogridCam?: [number, number, number] }
    dbg.__cogridZoom = z
    dbg.__cogridCam = [camera.position.x, camera.position.y, camera.position.z]
    setVisible((v) => (v ? z >= ZOOM_HIDE : z >= ZOOM_SHOW))
  })
  return visible
}
