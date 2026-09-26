import { useAppStore } from '../../state/store'
import { useCity } from './useCity'
import { BuildingsLayer } from './BuildingsLayer'
import { RoadsLayer } from './RoadsLayer'
import { WaterLayer } from './WaterLayer'
import { ParksLayer } from './ParksLayer'
import { TreesLayer } from './TreesLayer'
import { LabelChips } from './LabelChips'

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
 */
export function CityScene() {
  const activeScene = useAppStore((s) => s.activeScene)
  const { data } = useCity(activeScene)

  if (!data) return null

  return (
    <group>
      <ParksLayer parks={data.parks} />
      <WaterLayer water={data.water} />
      <RoadsLayer roads={data.roads} />
      <BuildingsLayer buildings={data.buildings} />
      <TreesLayer parks={data.parks} />
      <LabelChips data={data} />
    </group>
  )
}

export default CityScene
