import { useEffect } from 'react'
import { useAppStore } from '../../state/store'
import { useCity } from './useCity'
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
  useShadowRefresh(data)

  if (!data) return null

  return (
    <group>
      <ParksLayer parks={data.parks} />
      <WaterLayer water={data.water} />
      <RoadsLayer roads={data.roads} />
      <BuildingsLayer buildings={data.buildings} />
      <TreesLayer parks={data.parks} />
      {showLabels && <LabelChips data={data} />}
    </group>
  )
}

export default CityScene
