/**
 * GridOverlay — the electric-grid layer above the paper city.
 *
 * Fetches the region-wide dataset ONCE (module-cached promise shared by
 * both scene mounts), filters it to the active scene (~35km rule), and
 * composes:
 *   <ExistingLines>        dim merged segments + >=345kV pylons
 *   <ExistingSubstations>  instanced pads / transformer boxes / fences
 *   <ExistingPlants>       procedural plant compounds
 *   <PlannedLines>         sagged utility-colored corridors + pylons
 *   <PlannedStations>      planned substation compounds + pulse rings
 *   <PlannedPlants>        planned plant compounds w/ accent stripes
 *   <ProjectMarkers>       floating name chips + hover hit spheres
 *
 * If the API fetch fails the layer renders null — never fake geometry.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type BasemapProps, type FeatureCollection, type ProjectProps } from '../../lib/api'
import { useAppStore } from '../../state/store'
import { filterToScene, type SceneGrid } from './gridData'
import { ExistingLines, PlannedLines } from './TransmissionLines'
import { ExistingSubstations, PlannedStations } from './Stations'
import { ExistingPlants, PlannedPlants } from './Plants'
import { ProjectMarkers } from './ProjectMarkers'
import { useShadowRefresh } from '../city/cityUtils'

interface GridData {
  basemap: FeatureCollection<BasemapProps>
  projects: FeatureCollection<ProjectProps>
}

/**
 * Region-wide fetch shared across scene remounts. A failed attempt clears
 * the cache so a later mount can retry (e.g. backend starts late).
 */
let gridPromise: Promise<GridData> | null = null
function loadGridData(): Promise<GridData> {
  if (!gridPromise) {
    gridPromise = Promise.all([api.basemap(), api.projects()]).then(([basemap, projects]) => ({
      basemap,
      projects,
    }))
    gridPromise.catch(() => {
      gridPromise = null
    })
  }
  return gridPromise
}

export function GridOverlay() {
  const activeScene = useAppStore((s) => s.activeScene)
  const [data, setData] = useState<GridData | null>(null)

  useEffect(() => {
    let live = true
    loadGridData()
      .then((d) => {
        if (live) setData(d)
      })
      .catch(() => {
        /* load failure -> render null (no fabricated grid) */
      })
    return () => {
      live = false
    }
  }, [])

  const grid: SceneGrid | null = useMemo(
    () => (data ? filterToScene(data.basemap, data.projects, activeScene) : null),
    [data, activeScene],
  )

  // Pylons/plants/substations cast shadows — re-bake once when they change.
  useShadowRefresh(grid)

  if (!grid) return null
  return (
    <group>
      <ExistingLines lines={grid.existingLines} />
      <ExistingSubstations subs={grid.existingSubs} />
      <ExistingPlants plants={grid.existingPlants} />
      <PlannedLines projects={grid.lineProjects} />
      <PlannedStations projects={grid.stationProjects} />
      <PlannedPlants projects={grid.plantProjects} />
      <ProjectMarkers projects={grid.projects} />
    </group>
  )
}
