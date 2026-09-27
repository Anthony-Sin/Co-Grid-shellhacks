import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../state/store'
import { useCity } from './useCity'
import { useZoomAtLeast } from './cityUtils'
import {
  useCorridorDetail,
  useCorridorZoomGate,
  type CorridorDetail,
} from './corridorComposite'
import type { CityScene as CitySceneData } from '../../lib/api'
import { BuildingsLayer } from './BuildingsLayer'
import { RoadsLayer } from './RoadsLayer'
import { WaterLayer } from './WaterLayer'
import { ParksLayer } from './ParksLayer'
import { TreesLayer } from './TreesLayer'
import { LabelChips } from './LabelChips'
import { StateBoundsLayer } from './StateBoundsLayer'
import { useShadowRefresh } from './cityUtils'

/**
 * The real-data city scene: OSM buildings/roads/water/parks for the active
 * corridor (Savannah | Augusta), fetched from /api/city/{scene}.
 *
 * While loading — or if the backend is unreachable — this renders NOTHING.
 * Per project rules there is no fabricated fallback geometry.
 *
 * Layer stack (bottom → top): state land fill/borders → parks → water →
 * roads → buildings/trees. y-ordering is baked into the layer heights
 * (~0.05 land < 0.10 parks < 0.12 water < 0.15–0.35 roads by rank <
 * 0.42 footprint fills).
 *
 * mapStyle split (store): 'flat' renders the clean web-map read — land
 * fill, blue water, green parks, single-stroke neutral roads; 'sketch'
 * keeps the hand-drawn inked paper basemap + trees. Buildings are the
 * same flat 2D footprint fills (ShapeGeometry tiles — the "Google-Maps
 * density" layer) in BOTH styles — the 3D extrusion mode was dropped.
 * The state border stroke draws in BOTH.
 *
 * `showLabels` (the layers.labels toggle) gates only the floating name
 * chips — the basemap geometry itself is controlled by layers.basemap.
 */
export function CityScene({ showLabels = true }: { showLabels?: boolean }) {
  const activeScene = useAppStore((s) => s.activeScene)
  const mapStyle = useAppStore((s) => s.mapStyle)
  const flat = mapStyle === 'flat'
  const { data } = useCity(activeScene)

  // Deferred detail fetch (tiled-map style): the corridor artifacts are
  // ~160 MB of JSON total — the biggest single startup cost — and nothing
  // visible needs them at statewide overview. Prefetch early (zoom just
  // past overview, ~0.0035) so the data has already landed by the time
  // the render gate (0.004) opens — web maps prefetch the next zoom
  // level the same way. A selection also triggers it (zone tint needs
  // footprints) even at overview.
  const detailVisible = useCorridorZoomGate()
  const prefetch = useZoomAtLeast(0.0035, 0.7)
  const hasSelection = useAppStore((s) => s.selectedOverlapId != null)
  const corridor = useCorridorDetail(
    activeScene === 'state' && (prefetch || hasSelection),
  )
  const merged = useMemo<CorridorDetail | null>(() => {
    if (!data) return null
    if (activeScene !== 'state' || !corridor) {
      return { buildings: data.buildings, parks: data.parks, pois: data.pois ?? [] }
    }
    return {
      buildings: data.buildings.length
        ? [...data.buildings, ...corridor.buildings]
        : corridor.buildings,
      parks: [...data.parks, ...corridor.parks],
      pois: [...(data.pois ?? []), ...corridor.pois],
    }
  }, [data, corridor, activeScene])

  // LabelChips reads a whole CityScene (pois + named-building fallback) —
  // hand it the merged arrays so real corridor names land at true spots.
  const labelData = useMemo<CitySceneData | null>(
    () => (data && merged ? { ...data, buildings: merged.buildings, pois: merged.pois } : null),
    [data, merged],
  )

  // Ready flag for headless captures (scripts/screenshot.mjs waits on it).
  // Set after data lands + a few committed frames so geometry is on-screen —
  // or after 8 s regardless: headless rAF can stall under software GL, and
  // a screenshot is better slightly-early than never.
  useEffect(() => {
    if (!data) return
    const w = window as unknown as { __cogridReady?: boolean }
    w.__cogridReady = false
    let frames = 0
    let raf = 0
    const mark = () => {
      w.__cogridReady = true
    }
    const fallback = setTimeout(mark, 8000)
    const tick = () => {
      if (++frames >= 30) {
        clearTimeout(fallback)
        mark()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(fallback)
    }
  }, [data])

  // City shadow casters (sketch-mode trees) mount when `data` lands —
  // one shadow bake. `merged` flips on EVERY corridor arrival, and each
  // flip used to re-render the whole shadow map mid-gesture — debounced
  // to a single bake ~500 ms after the arrival burst goes quiet. In flat
  // mode no city caster is mounted at all (trees are sketch-only and the
  // fills never cast), so a null dep skips the poke honestly — and the
  // flat→sketch toggle re-arms it for the mounting trees.
  const [bakeDep, setBakeDep] = useState(merged)
  useEffect(() => {
    const t = setTimeout(() => setBakeDep(merged), 500)
    return () => clearTimeout(t)
  }, [merged])
  useShadowRefresh(flat ? null : bakeDep)

  if (!data || !merged || !labelData) return null

  return (
    <group>
      <StateBoundsLayer flat={flat} />
      <ParksLayer parks={merged.parks} flat={flat} />
      <WaterLayer water={data.water} flat={flat} />
      <RoadsLayer roads={data.roads} flat={flat} />
      {/* ONE buildings layer serves both styles: merged 2D footprint
          fills per ~12km cell, gated by the shared corridor zoom ramp.
          Trees remain sketch-only — no 2D canopy layer. */}
      <BuildingsLayer buildings={merged.buildings} detailVisible={detailVisible} />
      {!flat && <TreesLayer parks={merged.parks} />}
      {showLabels && <LabelChips data={labelData} />}
    </group>
  )
}

export default CityScene
