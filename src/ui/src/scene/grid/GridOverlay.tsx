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
 *
 * The panel's filters apply to this MAP layer too (kepler.gl rule): the
 * shared passesProjectFilters predicate gates every planned-project
 * bucket at once — corridor lines, station/plant compounds, name chips —
 * so a filtered-out project vanishes entirely (honest absence, never a
 * dimmed ghost). Basemap/existing layers stay untouched: they're context,
 * not coordination candidates.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type BasemapProps, type FeatureCollection, type ProjectProps } from '../../lib/api'
import { passesProjectFilters } from '../../lib/overlapFilters'
import { useAppStore } from '../../state/store'
import { filterToScene, type SceneGrid, type SceneProject } from './gridData'
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
  const utilityFilter = useAppStore((s) => s.utilityFilter)
  const yearFilter = useAppStore((s) => s.yearFilter)
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

  /** The panel's shared hard predicate, applied per project — identical
   *  semantics to the ranked list and zone layer (utility chips, region,
   *  build window). Memoized on the filter bag so downstream geometry
   *  memos (which key off array identity) only rebuild when the visible
   *  set actually changes. */
  const visible = useMemo(() => {
    if (!grid) return null
    const filters = { utilityFilter, yearRange: yearFilter }
    const keep = (p: SceneProject) => passesProjectFilters(p, filters)
    return {
      lineProjects: grid.lineProjects.filter(keep),
      stationProjects: grid.stationProjects.filter(keep),
      plantProjects: grid.plantProjects.filter(keep),
      projects: grid.projects.filter(keep),
    }
  }, [grid, utilityFilter, yearFilter])

  // Pylons/plants/substations cast shadows — re-bake once when they change
  // (filtering removes casters, so this keys off the FILTERED set).
  useShadowRefresh(visible)

  if (!grid || !visible) return null
  return (
    <group>
      <ExistingLines lines={grid.existingLines} />
      <ExistingSubstations subs={grid.existingSubs} />
      <ExistingPlants plants={grid.existingPlants} />
      <PlannedLines projects={visible.lineProjects} />
      <PlannedStations projects={visible.stationProjects} />
      <PlannedPlants projects={visible.plantProjects} />
      <ProjectMarkers projects={visible.projects} />
    </group>
  )
}
