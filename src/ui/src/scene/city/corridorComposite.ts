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
 * merged render shows real corridor detail inside the clean state sheet.
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
import { useAppStore } from '../../state/store'
import { deduped } from '../../ui/hooks/useApiData'

const METERS_PER_DEG_LAT = 110540
const METERS_PER_DEG_LON_EQUATOR = 111320

/** Corridor/metro extracts to fold into the state scene. `idBias`
 * guarantees building-id uniqueness across artifacts — composited
 * footprints share the OSM id space (label-chip keys use `b-${id}`).
 * 2.1e9 steps; `>>>0` consumers wrap mod 2^32 harmlessly. */
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
 * Per-payload projection cache. Each payload object is created once (in
 * setPayloads) and payloads only accumulate, so keying on the payload
 * reference projects each corridor EXACTLY ONCE — arrival N pays O(new)
 * instead of re-projecting ~460k footprints an Nth time (the audit's
 * zoom stall: ~150–400 ms of corridorToState per arrival). WeakMap so
 * dropped payloads GC rather than pinning ~50 MB slices.
 */
const sliceCache = new WeakMap<CorridorPayload, CorridorDetail>()

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

  const checkProximityRef = useRef<() => void>(() => {})

  const fetchOne = useCallback((c: { scene: SceneId; idBias: number }) => {
    if (doneRef.current.has(c.scene) || inflightRef.current.has(c.scene)) return
    // Serialize corridor downloads — several metros can sit inside the
    // radius at once (Atlanta+Athens ≈50MB) and parallel JSON.parse +
    // compositing spikes memory hard enough to kill weak browsers (QA
    // crash report). One at a time; the finally re-checks proximity so
    // a queued corridor starts when the current one lands.
    if (inflightRef.current.size > 0) return
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
      .finally(() => {
        inflightRef.current.delete(c.scene)
        checkProximityRef.current()
      })
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
  checkProximityRef.current = checkProximity

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
    // Concat the cached per-payload slices — element refs stay stable
    // across arrivals, which is exactly what the append-only indexes
    // downstream (indexBuildings / partitionCells) prove growth against.
    const out: CorridorDetail = { buildings: [], parks: [], pois: [] }
    for (const p of payloads) {
      let slice = sliceCache.get(p)
      if (!slice) {
        slice = { buildings: [], parks: [], pois: [] }
        corridorToState(p, slice)
        sliceCache.set(p, slice)
      }
      // push-per-element, never spread: ~460k args would blow the call
      // stack; ref copies are ~ms next to the projection they replace.
      for (const b of slice.buildings) out.buildings.push(b)
      for (const pk of slice.parks) out.parks.push(pk)
      for (const poi of slice.pois) out.pois.push(poi)
    }
    if (import.meta.env.DEV && !compositeLogged) {
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

/** Ortho zoom where corridor building fills fade in/out — a hysteresis
 * band so a camera parked between the two thresholds keeps its last
 * state instead of flickering. State overview sits at zoom≈0.0022;
 * city-scale reading starts around ~0.01. The fills are cheap merged
 * 2D ShapeGeometry tiles (no extrusions), so the gate can open early —
 * footprints appear just past overview instead of popping late; below
 * the band ~460k sub-pixel footprints are still skipped vertex noise. */
const ZOOM_SHOW = 0.004
const ZOOM_HIDE = 0.003

/** Per-frame __cogridZoom/__cogridCam telemetry is opt-in — dev builds
 *  or a `?debugcam` query flag (the pose handles __cogridCamera et al.
 *  in the effect below stay always-on; only the per-frame writes gate). */
const CAM_TELEMETRY =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('debugcam'))

/**
 * Zoom gate for the merged corridor building fills. Reads camera.zoom
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
      __cogridStore?: unknown
      __cogridInvalidate?: () => void
    }
    w.__cogridCamera = camera
    w.__cogridControls = controls
    w.__cogridStore = useAppStore
    w.__cogridInvalidate = invalidate
  }, [camera, controls, invalidate])
  useFrame(() => {
    const z = 'zoom' in camera ? (camera as { zoom: number }).zoom : 1
    // debug telemetry for headless captures (no zoom URL param exists) —
    // dev mode or ?debugcam=1 only; production frames skip the [x,y,z] alloc
    if (CAM_TELEMETRY) {
      const dbg = window as unknown as { __cogridZoom?: number; __cogridCam?: [number, number, number] }
      dbg.__cogridZoom = z
      dbg.__cogridCam = [camera.position.x, camera.position.y, camera.position.z]
    }
    setVisible((v) => (v ? z >= ZOOM_HIDE : z >= ZOOM_SHOW))
  })
  return visible
}
