import { useEffect, useMemo } from 'react'
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
import { useShadowRefresh } from './cityUtils'

/**
 * The real-data city scene: OSM buildings/roads/water/parks for the active
 * corridor (Savannah | Augusta), fetched from /api/city/{scene}.
 *
 * While loading — or if the backend is unreachable — this renders NOTHING.
 * Per project rules there is no fabricated fallback geometry.
 *
 * Layer stack (bottom → top): parks → water → roads → buildings/trees.
 * y-ordering is baked into the layer heights (~0.10 parks < 0.12 water <
 * 0.15–0.35 roads by rank < extruded buildings).
 *
 * `showLabels` (the layers.labels toggle) gates only the floating name
 * chips — the basemap geometry itself is controlled by layers.basemap.
 */
export function CityScene({ showLabels = true }: { showLabels?: boolean }) {
  const activeScene = useAppStore((s) => s.activeScene)
  const { data } = useCity(activeScene)

  // Deferred detail fetch (tiled-map style): the two corridor artifacts
  // are ~50 MB of JSON — the biggest single startup cost — and nothing
  // visible needs them at statewide overview. Prefetch early (zoom just
  // past overview, ~0.0035) so the data has already landed by the time
  // the render gate (0.008) opens — web maps prefetch the next zoom
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
  // Set after data lands + a few committed frames so geometry is on-screen.
  useEffect(() => {
    if (!data) return
    ;(window as unknown as { __cogridReady?: boolean }).__cogridReady = false
    let frames = 0
    let raf = 0
    const tick = () => {
      if (++frames >= 30) {
        ;(window as unknown as { __cogridReady?: boolean }).__cogridReady = true
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [data])

  // All city casters mount together when `data` lands — one shadow bake.
  // `merged` also flips once when corridor detail lands, re-baking for
  // the late-mounting ~148k corridor casters.
  useShadowRefresh(merged)

  if (!data || !merged || !labelData) return null

  return (
    <group>
      <ParksLayer parks={merged.parks} />
      <WaterLayer water={data.water} />
      <RoadsLayer roads={data.roads} />
      <BuildingsLayer buildings={merged.buildings} detailVisible={detailVisible} />
      <TreesLayer parks={merged.parks} />
      {showLabels && <LabelChips data={labelData} />}
    </group>
  )
}

export default CityScene
